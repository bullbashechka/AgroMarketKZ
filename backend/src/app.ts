import { healthResponseSchema } from "@agromarket/contracts";
import { Hono } from "hono";
import { cors } from "hono/cors";

type Bindings = {
  WEBAPP_ORIGIN?: string;
};

type AppOptions = {
  webappOrigin?: string;
};

export function createApp(options: AppOptions = {}) {
  const app = new Hono<{ Bindings: Bindings }>();

  app.use(
    "*",
    cors({
      origin: (_origin, c) => options.webappOrigin ?? c.env.WEBAPP_ORIGIN ?? "http://localhost:5173",
      allowHeaders: ["Content-Type", "Authorization"],
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]
    })
  );

  app.get("/health", (c) => {
    const response = healthResponseSchema.parse({
      status: "ok",
      app: "backend"
    });

    return c.json(response);
  });

  return app;
}
