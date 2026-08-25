import { healthResponseSchema } from "@agromarket/contracts";
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { ZodError } from "zod";
import { isConnectionError } from "./db";
import { type AppEnv, type HonoEnv, resolveEnv } from "./env";
import { HttpError } from "./lib/errors";
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
    c.set("env", resolveEnv(c.env, options.env));
    await next();
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
    await next();
    const status = c.res.status;
    c.get("env").REQUEST_METRICS?.writeDataPoint({
      indexes: [status >= 500 ? "server_error" : status >= 400 ? "client_error" : "ok"],
      blobs: [c.req.method, new URL(c.req.url).pathname]
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
      c.get("env").REQUEST_METRICS?.writeDataPoint({
        indexes: ["db_conn_error"],
        blobs: [c.req.method, new URL(c.req.url).pathname]
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
