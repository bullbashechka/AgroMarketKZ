import { healthResponseSchema } from "@agromarket/contracts";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { ZodError } from "zod";
import { type AppEnv, type HonoEnv, resolveEnv } from "./env";
import { HttpError } from "./lib/errors";
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

const BODY_LIMIT_ERROR = { error: "Размер запроса превышает 256 KiB" };

export function createApp(options: AppOptions = {}) {
  const app = new Hono<HonoEnv>();

  // Слияние окружения: Workers-биндинги (c.env) + локальный override (Bun.env).
  app.use("*", async (c, next) => {
    c.set("env", resolveEnv(c.env, options.env));
    await next();
  });

  app.use("*", async (c, next) => {
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Referrer-Policy", "no-referrer");
    await next();
  });

  app.use(
    "*",
    cors({
      origin: (origin, c) => {
        const allowed = c.get("env").WEBAPP_ORIGIN;
        return origin === allowed ? origin : undefined;
      },
      allowHeaders: ["Content-Type", "Authorization"],
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]
    })
  );

  app.use(
    "*",
    bodyLimit({
      maxSize: JSON_BODY_LIMIT_BYTES,
      onError: (c) => c.json(BODY_LIMIT_ERROR, 413),
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
      return c.json({ error: err.message, ...err.details }, err.status as ContentfulStatusCode);
    }
    if (err instanceof ZodError) {
      return c.json({ error: "Проверьте корректность данных", code: "VALIDATION_ERROR" }, 400);
    }
    console.error(err);
    return c.json({ error: "Внутренняя ошибка сервера" }, 500);
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
