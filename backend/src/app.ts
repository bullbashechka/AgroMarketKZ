import { healthResponseSchema } from "@agromarket/contracts";
import { Hono } from "hono";
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

export function createApp(options: AppOptions = {}) {
  const app = new Hono<HonoEnv>();

  // Слияние окружения: Workers-биндинги (c.env) + локальный override (Bun.env).
  app.use("*", async (c, next) => {
    c.set("env", resolveEnv(c.env, options.env));
    await next();
  });

  app.use(
    "*",
    cors({
      origin: (_origin, c) => c.get("env").WEBAPP_ORIGIN ?? "http://localhost:5173",
      allowHeaders: ["Content-Type", "Authorization"],
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]
    })
  );

  app.onError((err, c) => {
    if (err instanceof HttpError) {
      return c.json({ error: err.message }, err.status as ContentfulStatusCode);
    }
    if (err instanceof ZodError) {
      return c.json({ error: "Проверьте корректность данных", issues: err.issues }, 400);
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
