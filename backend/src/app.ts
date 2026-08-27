import { healthResponseSchema } from "@agromarket/contracts";
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { matchedRoutes } from "hono/route";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { ZodError } from "zod";
import {
  createDatabaseInvocation as defaultCreateDatabaseInvocation,
  isConnectionError,
  type DatabaseInvocation,
} from "./db";
import { type AppEnv, type HonoEnv, resolveEnv } from "./env";
import { HttpError } from "./lib/errors";
import { metricNow, metricRoute, writeMetric } from "./lib/metrics";
import { timingSafeEqual } from "./lib/telegram";
import { adminRoutes } from "./routes/admin";
import { authRoutes } from "./routes/auth";
import { catalogRoutes } from "./routes/catalog";
import { favoritesRoutes } from "./routes/favorites";
import { feedbackRoutes } from "./routes/feedback";
import { profileRoutes } from "./routes/profile";
import { requestsRoutes } from "./routes/requests";
import { settingsRoutes } from "./routes/settings";
import { telegramRoutes } from "./routes/telegram";

type AppOptions = {
  /** Локальный override окружения (Bun.env). На Workers не передаётся — используется c.env. */
  env?: Partial<AppEnv>;
  /** Test seam and invocation-owned provider; production uses the default provider. */
  createDatabaseInvocation?: (env: AppEnv) => DatabaseInvocation;
  /** Bun owns local client disposal; Workers leave cleanup to Hyperdrive/platform. */
  disposeDatabase?: boolean;
};

export const JSON_BODY_LIMIT_BYTES = 256 * 1024;

const BODY_LIMIT_ERROR = {
  error: "Размер запроса превышает 256 KiB",
  code: "BODY_TOO_LARGE",
};

function safeErrorMetadata(err: unknown): Record<string, unknown> {
  if (typeof err !== "object" || err === null) return {};
  const source = err as {
    name?: unknown;
    code?: unknown;
    constraint?: unknown;
    schema?: unknown;
    table?: unknown;
    column?: unknown;
    schema_name?: unknown;
    table_name?: unknown;
    column_name?: unknown;
    constraint_name?: unknown;
  };
  return Object.fromEntries(
    Object.entries({
      name: source.name,
      code: source.code,
      constraint: source.constraint ?? source.constraint_name,
      schema: source.schema ?? source.schema_name,
      table: source.table ?? source.table_name,
      column: source.column ?? source.column_name,
    }).filter(([, value]) => typeof value === "string" && value.length > 0),
  );
}

function safeErrorKind(err: unknown): string {
  if (err instanceof Error && err.name) return err.name;
  return typeof err;
}

function requestIdOf(c: Context<HonoEnv>): string {
  return c.get("requestId");
}

function errorBody(c: Context<HonoEnv>, body: Record<string, unknown>): Record<string, unknown> {
  return { ...body, requestId: requestIdOf(c) };
}

export function createApp(options: AppOptions = {}) {
  const app = new Hono<HonoEnv>();

  app.use("*", async (c, next) => {
    const requestId = crypto.randomUUID();
    c.set("requestId", requestId);
    c.header("X-Request-ID", requestId);
    await next();
  });

  // Слияние окружения: Workers-биндинги (c.env) + локальный override (Bun.env).
  app.use("*", async (c, next) => {
    const env = resolveEnv(c.env, options.env);
    const database = (options.createDatabaseInvocation ?? defaultCreateDatabaseInvocation)(env);
    const backgroundTasks = new Set<Promise<unknown>>();
    c.set("env", env);
    c.set("database", database);
    c.set("backgroundTasks", backgroundTasks);
    try {
      await next();
    } finally {
      if (options.disposeDatabase) {
        await Promise.allSettled([...backgroundTasks]);
        await database.dispose();
      }
    }
  });

  app.use("*", async (c, next) => {
    const env = c.get("env");
    const path = new URL(c.req.url).pathname;
    const isWebhook = path === "/telegram/webhook";
    if (env.APP_ENV === "production" && path !== "/health" && !isWebhook) {
      const proxySecret = c.req.header("X-Agromarket-Proxy") ?? "";
      if (!env.PAGES_PROXY_SECRET || !timingSafeEqual(proxySecret, env.PAGES_PROXY_SECRET)) {
        throw new HttpError(401, "Запрос должен пройти через приложение");
      }
      // Pages and Worker can deploy independently. Legacy Pages omit the
      // version while the current proxy sends version 1; reject only an
      // explicitly incompatible protocol rather than failing open.
      const proxyVersion = c.req.header("X-Agromarket-Proxy-Version");
      if (proxyVersion !== undefined && proxyVersion !== "1") {
        throw new HttpError(401, "Неподдерживаемая версия proxy-протокола");
      }
      if (["POST", "PUT", "PATCH", "DELETE"].includes(c.req.method)) {
        const origin = c.req.header("Origin");
        const forwardedOrigin = c.req.header("X-Forwarded-Origin");
        if (!origin || origin !== forwardedOrigin) {
          throw new HttpError(403, "Недопустимый Origin", { code: "CSRF_ORIGIN_INVALID" });
        }
        if (!c.req.header("Content-Type")?.startsWith("application/json")) {
          throw new HttpError(415, "Ожидается JSON-запрос", { code: "CSRF_CONTENT_TYPE_INVALID" });
        }
      }
    }
    await next();
  });

  app.use("*", async (c, next) => {
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Referrer-Policy", "no-referrer");
    // API responses can contain profile, contact and admin data. Never let a
    // browser, intermediary or an accidental public cache persist them.
    c.header("Cache-Control", "no-store");
    await next();
  });

  // Счётчик исходов для алертинга (см. lib/alerts.ts) — без REQUEST_METRICS (локально/пока не
  // настроен биндинг) молча no-op.
  app.use("*", async (c, next) => {
    const startedAt = metricNow();
    await next();
    const status = c.res.status;
    const category = status >= 500 ? "server_error" : status >= 400 ? "client_error" : "ok";
    writeMetric(c.get("env"), {
      kind: "http",
      operation: metricRoute(matchedRoutes(c).at(-1)?.path ?? ""),
      outcome: category,
      category,
      durationMs: metricNow() - startedAt,
    });
  });

  app.use(
    "*",
    cors({
      origin: (origin, c) => {
        const allowed = c.get("env").WEBAPP_ORIGIN;
        return origin === allowed ? origin : undefined;
      },
      allowHeaders: ["Content-Type", "Authorization"],
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      credentials: true,
    })
  );

  app.use(
    "*",
    bodyLimit({
      maxSize: JSON_BODY_LIMIT_BYTES,
      onError: (c) => c.json(errorBody(c, BODY_LIMIT_ERROR), 413),
    }),
  );

  app.onError((err, c) => {
    if (err instanceof HttpError) {
      const retryAfterSeconds = err.details.retryAfterSeconds;
      if (
        err.status === 429 &&
        typeof retryAfterSeconds === "number" &&
        Number.isFinite(retryAfterSeconds) &&
        Number.isInteger(retryAfterSeconds) &&
        retryAfterSeconds > 0
      ) {
        c.header("Retry-After", String(retryAfterSeconds));
      }
      const { code: detailCode, ...details } = err.details;
      return c.json(
        errorBody(c, {
          error: err.message,
          code: typeof detailCode === "string"
            ? detailCode
            : err.status === 429
              ? "RATE_LIMITED"
              : "HTTP_ERROR",
          ...details,
        }),
        err.status as ContentfulStatusCode,
      );
    }
    if (err instanceof ZodError) {
      return c.json(errorBody(c, {
        error: "Проверьте корректность данных",
        code: "VALIDATION_ERROR",
      }), 400);
    }
    const connectionError = isConnectionError(err);
    console.error("request failed", {
      event: "request_error",
      requestId: requestIdOf(c),
      method: c.req.method,
      path: new URL(c.req.url).pathname,
      connectionError,
      errorCode: connectionError ? "DB_CONNECTION_ERROR" : "INTERNAL_ERROR",
      errorKind: safeErrorKind(err),
      ...safeErrorMetadata(err),
    });
    if (connectionError) {
      writeMetric(c.get("env"), {
        kind: "db",
        operation: "query",
        outcome: "error",
        category: "db_conn_error",
        durationMs: 0,
      });
      return c.json(errorBody(c, {
        error: "Сервис временно недоступен. Попробуйте ещё раз",
        code: "DB_TEMPORARILY_UNAVAILABLE",
        retryable: true,
      }), 503);
    }
    return c.json(errorBody(c, {
      error: "Внутренняя ошибка сервера",
      code: "INTERNAL_ERROR",
    }), 500);
  });

  app.get("/health", (c) => {
    return c.json(
      healthResponseSchema.parse({
        status: "ok",
        app: "backend"
      })
    );
  });

  app.route("/auth", authRoutes);
  app.route("/profile", profileRoutes);
  app.route("/catalog", catalogRoutes);
  app.route("/settings", settingsRoutes);
  app.route("/favorites", favoritesRoutes);
  app.route("/requests", requestsRoutes);
  app.route("/feedback", feedbackRoutes);
  app.route("/telegram", telegramRoutes);
  app.route("/admin", adminRoutes);

  return app;
}
