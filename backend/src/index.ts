import { healthResponseSchema } from "@agromarket/contracts";
import { Hono } from "hono";
import { cors } from "hono/cors";

const app = new Hono();

app.use(
  "*",
  cors({
    origin: Bun.env.WEBAPP_ORIGIN ?? "http://localhost:5173",
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

const port = Number(Bun.env.PORT ?? 3000);

Bun.serve({
  port,
  fetch: app.fetch
});

console.info(`Backend listening on http://localhost:${port}`);
