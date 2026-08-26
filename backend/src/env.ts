import type { Context } from "hono";
import { z } from "zod";
import type { DatabaseInvocation } from "./db";

/** Минимальный structural-контракт нативного Cloudflare Rate Limiting binding. */
export interface RateLimitBinding {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

/** Минимальный structural-контракт Cloudflare Queue producer binding. */
export interface QueueBinding<T> {
  send(message: T): Promise<unknown>;
}

/** Минимальный structural-контракт R2 bucket binding для независимых backup-объектов. */
export interface R2BucketBinding {
  put(key: string, value: ReadableStream | ArrayBuffer | ArrayBufferView | string, options?: unknown): Promise<unknown>;
}

/**
 * Полный набор переменных окружения backend.
 * На Cloudflare Workers приходят как `c.env` (bindings/secrets),
 * локально на Bun — пробрасываются в `createApp({ env })` из `Bun.env`.
 */
export interface AppEnv {
  APP_ENV?: "development" | "staging" | "production";
  WEBAPP_ORIGIN: string;
  /** Shared only by Pages Function and Worker; blocks direct production browser traffic. */
  PAGES_PROXY_SECRET?: string;
  /** Единственный Telegram id, который подтверждает смену notification chat. */
  ADMIN_OWNER_TELEGRAM_ID?: string;
  TELEGRAM_BOT_TOKEN: string;
  /** Секрет вебхука (secret_token из setWebhook); без него вебхук отвечает 401. */
  TELEGRAM_WEBHOOK_SECRET?: string;
  /** Username бота без @ — для t.me deep-link-кнопок; без него кнопки опускаются. */
  TELEGRAM_BOT_USERNAME?: string;
  /** Shortname Mini App из /newapp BotFather — вторая часть t.me deep-link. */
  TELEGRAM_MINIAPP_SHORTNAME?: string;
  ADMIN_ALLOWLIST: string;
  DATABASE_URL?: string;
  /** Hyperdrive поверх Supavisor session-mode (порт 5432), caching отключён. Локально на Bun отсутствует — createClient падает обратно на DATABASE_URL. */
  HYPERDRIVE?: Hyperdrive;
  SUPABASE_URL: string;
  SUPABASE_STORAGE_BUCKET: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  /** "false" включает реальное удаление в storageCleanup; любое другое значение (в т.ч. отсутствие) — dry-run. */
  STORAGE_CLEANUP_DRY_RUN?: string;
  /** Идентификатор изолированного E2E-прогона; ограничивает teardown его namespace. */
  E2E_RUN_ID?: string;
  /** Кеш {tokenVersion, isRegistered} по userId, TTL 60с. Отсутствует локально на Bun — тогда findAuthUserCached деградирует к прямому SELECT. */
  AUTH_CACHE_KV?: KVNamespace;
  /** `disabled` (рекомендуется для строгого отзыва) отключает чтение auth-кеша; `read-through` включает его явно. */
  AUTH_CACHE_MODE?: "disabled" | "read-through";
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
  /** Очередь гарантированной доставки Telegram-уведомлений. */
  NOTIFICATION_QUEUE?: QueueBinding<{ outboxId: string }>;
  /** Очередь update id после его атомарного сохранения из Telegram webhook. */
  TELEGRAM_UPDATE_QUEUE?: QueueBinding<{ updateId: number }>;
  /** Приватный R2 bucket для независимых резервных копий Storage. */
  STORAGE_BACKUP?: R2BucketBinding;
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
  database: DatabaseInvocation;
  backgroundTasks: Set<Promise<unknown>>;
  auth: AuthUser;
  requestId: string;
  adminAuditCommitted: boolean;
}

/** Тип окружения Hono для всего backend (Bindings + Variables). */
export type HonoEnv = {
  Bindings: Partial<WorkerEnv>;
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
  const env = { ...(bindings ?? {}), ...(override ?? {}) } as AppEnv;
  if (env.APP_ENV !== "production") return env;

  const scalar = z.object({
    APP_ENV: z.literal("production"),
    WEBAPP_ORIGIN: z.url(),
    PAGES_PROXY_SECRET: z.string().min(32),
    ADMIN_ALLOWLIST: z.string().min(1),
    ADMIN_OWNER_TELEGRAM_ID: z.string().regex(/^\d+$/),
    TELEGRAM_BOT_TOKEN: z.string().min(20),
    TELEGRAM_WEBHOOK_SECRET: z.string().min(20),
    SUPABASE_URL: z.url(),
    SUPABASE_STORAGE_BUCKET: z.string().min(1),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  }).parse(env);
  if (!env.HYPERDRIVE?.connectionString) {
    throw new Error("Production требует обязательный Hyperdrive binding");
  }
  if (!env.API_READ_RATE_LIMITER || !env.API_MUTATION_RATE_LIMITER || !env.AUTH_RATE_LIMITER || !env.AUTH_IDENTITY_RATE_LIMITER) {
    throw new Error("Production требует все rate-limit bindings");
  }
  if (!env.NOTIFICATION_QUEUE) {
    throw new Error("Production требует NOTIFICATION_QUEUE");
  }
  if (!env.TELEGRAM_UPDATE_QUEUE) {
    throw new Error("Production требует TELEGRAM_UPDATE_QUEUE");
  }
  return { ...env, ...scalar };
}

/** Достаёт разрешённое окружение из контекста (его кладёт middleware в `createApp`). */
export function getEnv(c: Context<HonoEnv>): AppEnv {
  return c.get("env");
}

/** Доступ к DB capability, принадлежащей текущему request invocation. */
export function getDatabase(c: Context<HonoEnv>): DatabaseInvocation {
  return c.get("database");
}
