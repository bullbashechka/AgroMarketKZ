import { createApp } from "./app";

const app = createApp({
  env: {
    WEBAPP_ORIGIN: Bun.env.WEBAPP_ORIGIN,
    JWT_SECRET: Bun.env.JWT_SECRET,
    TELEGRAM_BOT_TOKEN: Bun.env.TELEGRAM_BOT_TOKEN,
    ADMIN_ALLOWLIST: Bun.env.ADMIN_ALLOWLIST,
    DATABASE_URL: Bun.env.DATABASE_URL
  }
});

const port = Number(Bun.env.PORT ?? 3000);

Bun.serve({
  port,
  fetch: app.fetch
});

console.info(`Backend listening on http://localhost:${port}`);
