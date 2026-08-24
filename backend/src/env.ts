import type { Context } from "hono";

/** Минимальный structural-контракт нативного Cloudflare Rate Limiting binding. */
export interface RateLimitBinding {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

/**
 * Полный набор переменных окружения backend.
 * На Cloudflare Workers приходят как `c.env` (bindings/secrets),
 * локально на Bun — пробрасываются в `createApp({ env })` из `Bun.env`.
 */
export interface AppEnv {
  WEBAPP_ORIGIN: string;
  JWT_SECRET: string;
  TELEGRAM_BOT_TOKEN: string;
  /** Секрет вебхука (secret_token из setWebhook); без него вебхук отвечает 401. */
  TELEGRAM_WEBHOOK_SECRET?: string;
  /** Username бота без @ — для t.me deep-link-кнопок; без него кнопки опускаются. */
  TELEGRAM_BOT_USERNAME?: string;
  /** Shortname Mini App из /newapp BotFather — вторая часть t.me deep-link. */
  TELEGRAM_MINIAPP_SHORTNAME?: string;
  ADMIN_ALLOWLIST: string;
  DATABASE_URL: string;
  /** Hyperdrive поверх Supavisor session-mode (порт 5432), caching отключён. Локально на Bun отсутствует — createClient падает обратно на DATABASE_URL. */
  HYPERDRIVE?: Hyperdrive;
  SUPABASE_URL: string;
  SUPABASE_STORAGE_BUCKET: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  /** "false" включает реальное удаление в storageCleanup; любое другое значение (в т.ч. отсутствие) — dry-run. */
  STORAGE_CLEANUP_DRY_RUN?: string;
  /** Идентификатор изолированного E2E-прогона; включает только его test-cleanup endpoint. */
  E2E_RUN_ID?: string;
  /** Кеш {tokenVersion, isRegistered} по userId, TTL 60с. Отсутствует локально на Bun — тогда findAuthUserCached деградирует к прямому SELECT. */
  AUTH_CACHE_KV?: KVNamespace;
  /** Отсутствуют при локальном запуске без Wrangler и тогда являются no-op. */
  API_READ_RATE_LIMITER?: RateLimitBinding;
  API_MUTATION_RATE_LIMITER?: RateLimitBinding;
  /** Широкий потолок по IP для pre-auth `/auth/*`. */
  AUTH_RATE_LIMITER?: RateLimitBinding;
  /** Строгий лимит по составному ключу IP + неподписанный Telegram id для `/auth/*`. */
  AUTH_IDENTITY_RATE_LIMITER?: RateLimitBinding;
  /** Счётчик исходов запросов (5xx/4xx/ok, ошибки подключения к БД) для алертинга. См. lib/alerts.ts. */
  REQUEST_METRICS?: AnalyticsEngineDataset;
  /** Account id для чтения REQUEST_METRICS через Analytics Engine SQL API (не секрет). */
  CLOUDFLARE_ACCOUNT_ID?: string;
  /** Токен с правами только Account Analytics: Read — отдельный от деплойного CLOUDFLARE_API_TOKEN. */
  CF_ANALYTICS_API_TOKEN?: string;
}

/** Аутентифицированный пользователь, кладётся `requireAuth` в контекст. */
export interface AuthUser {
  userId: string;
  telegramId: number;
  isRegistered: boolean;
}

/** Контекстные переменные Hono. */
export interface AppVariables {
  env: AppEnv;
  auth: AuthUser;
  requestId: string;
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
