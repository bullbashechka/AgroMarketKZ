import { createApp } from "./app";
import type { AppEnv } from "./env";

const app = createApp({
  env: {
    APP_ENV: Bun.env.APP_ENV as AppEnv["APP_ENV"],
    WEBAPP_ORIGIN: Bun.env.WEBAPP_ORIGIN,
    PAGES_PROXY_SECRET: Bun.env.PAGES_PROXY_SECRET,
    ADMIN_OWNER_TELEGRAM_ID: Bun.env.ADMIN_OWNER_TELEGRAM_ID,
    TELEGRAM_BOT_TOKEN: Bun.env.TELEGRAM_BOT_TOKEN,
    TELEGRAM_WEBHOOK_SECRET: Bun.env.TELEGRAM_WEBHOOK_SECRET,
    TELEGRAM_BOT_USERNAME: Bun.env.TELEGRAM_BOT_USERNAME,
    TELEGRAM_MINIAPP_SHORTNAME: Bun.env.TELEGRAM_MINIAPP_SHORTNAME,
    ADMIN_ALLOWLIST: Bun.env.ADMIN_ALLOWLIST,
    DATABASE_URL: Bun.env.DATABASE_URL,
    SUPABASE_URL: Bun.env.SUPABASE_URL,
    SUPABASE_STORAGE_BUCKET: Bun.env.SUPABASE_STORAGE_BUCKET,
    SUPABASE_SERVICE_ROLE_KEY: Bun.env.SUPABASE_SERVICE_ROLE_KEY,
    STORAGE_CLEANUP_DRY_RUN: Bun.env.STORAGE_CLEANUP_DRY_RUN,
    E2E_RUN_ID: Bun.env.E2E_RUN_ID,
    AUTH_CACHE_MODE: Bun.env.AUTH_CACHE_MODE as "disabled" | "read-through" | undefined,
  }
});

const port = Number(Bun.env.PORT ?? 3000);

Bun.serve({
  port,
  fetch: app.fetch
});

console.info(`Backend listening on http://localhost:${port}`);
