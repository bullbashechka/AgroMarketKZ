import type { Context } from "hono";

/**
 * Полный набор переменных окружения backend.
 * На Cloudflare Workers приходят как `c.env` (bindings/secrets),
 * локально на Bun — пробрасываются в `createApp({ env })` из `Bun.env`.
 */
export interface AppEnv {
  WEBAPP_ORIGIN?: string;
  JWT_SECRET: string;
  TELEGRAM_BOT_TOKEN: string;
  ADMIN_ALLOWLIST: string;
  DATABASE_URL: string;
  SUPABASE_URL: string;
  SUPABASE_STORAGE_BUCKET: string;
}

/** Аутентифицированный пользователь, кладётся `requireAuth` в контекст. */
export interface AuthUser {
  userId: string;
  telegramId: number;
}

/** Контекстные переменные Hono. */
export interface AppVariables {
  env: AppEnv;
  auth: AuthUser;
}

/** Тип окружения Hono для всего backend (Bindings + Variables). */
export type HonoEnv = {
  Bindings: Partial<AppEnv>;
  Variables: AppVariables;
};

/**
 * Сливает окружение из двух источников: Workers-биндинги (`c.env`) и
 * локальный override (`Bun.env`, переданный в `createApp`). Override имеет приоритет,
 * что позволяет одному коду работать и на Workers, и на Bun.
 */
export function resolveEnv(
  bindings: Partial<AppEnv> | undefined,
  override: Partial<AppEnv> | undefined
): AppEnv {
  return { ...(bindings ?? {}), ...(override ?? {}) } as AppEnv;
}

/** Достаёт разрешённое окружение из контекста (его кладёт middleware в `createApp`). */
export function getEnv(c: Context<HonoEnv>): AppEnv {
  return c.get("env");
}
