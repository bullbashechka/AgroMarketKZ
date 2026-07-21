import { createApp } from "./app";

const app = createApp({
  env: {
    WEBAPP_ORIGIN: Bun.env.WEBAPP_ORIGIN,
    JWT_SECRET: Bun.env.JWT_SECRET,
    TELEGRAM_BOT_TOKEN: Bun.env.TELEGRAM_BOT_TOKEN,
    TELEGRAM_WEBHOOK_SECRET: Bun.env.TELEGRAM_WEBHOOK_SECRET,
    TELEGRAM_BOT_USERNAME: Bun.env.TELEGRAM_BOT_USERNAME,
    TELEGRAM_MINIAPP_SHORTNAME: Bun.env.TELEGRAM_MINIAPP_SHORTNAME,
    ADMIN_ALLOWLIST: Bun.env.ADMIN_ALLOWLIST,
    DATABASE_URL: Bun.env.DATABASE_URL,
    SUPABASE_URL: Bun.env.SUPABASE_URL,
    SUPABASE_STORAGE_BUCKET: Bun.env.SUPABASE_STORAGE_BUCKET,
    SUPABASE_SERVICE_ROLE_KEY: Bun.env.SUPABASE_SERVICE_ROLE_KEY,
    STORAGE_CLEANUP_DRY_RUN: Bun.env.STORAGE_CLEANUP_DRY_RUN
  }
});

const port = Number(Bun.env.PORT ?? 3000);

Bun.serve({
  port,
  fetch: app.fetch
});

console.info(`Backend listening on http://localhost:${port}`);
