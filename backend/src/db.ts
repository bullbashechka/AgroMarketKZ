import postgres, { type Sql } from "postgres";
import { HttpError } from "./lib/errors";
import type { AppEnv } from "./env";

const { PostgresError } = postgres;

let client: Sql | undefined;
let reconnecting: Promise<void> | undefined;

export const POSTGRES_POOL_OPTIONS = Object.freeze({
  max: 3,
  idle_timeout: 20,
  connect_timeout: 10,
  prepare: false,
}) satisfies postgres.Options<{}>;

const CONNECTION_ERROR_CODES = new Set([
  "CONNECTION_DESTROYED",
  "CONNECTION_CLOSED",
  "CONNECTION_ENDED",
  "CONNECT_TIMEOUT",
  "ECONNRESET",
  "ECONNREFUSED",
  "ECONNABORTED",
  "ETIMEDOUT",
  "EPIPE",
  "ENETUNREACH",
  "EHOSTUNREACH",
]);

const CLOUDFLARE_POSTGRES_WRITE_FRAMES = [
  "at EventEmitter.write",
  "at nextWrite",
  "at cachedError",
  "at new Query",
] as const;

type DatabaseEnv = Pick<AppEnv, "DATABASE_URL" | "HYPERDRIVE">;

function createClient(env: DatabaseEnv): Sql {
  const url = env.HYPERDRIVE?.connectionString ?? env.DATABASE_URL;
  if (!url) throw new Error("Не задан Hyperdrive или DATABASE_URL");
  return postgres(url, POSTGRES_POOL_OPTIONS);
}

/**
 * Ошибки соединения определяем по кодам postgres.js и сокета. Cloudflare Web Streams иногда
 * отклоняет запись в закрытый postgres.js socket без `code` и даже без полезного `message`, но
 * postgres.js добавляет к stack устойчивую цепочку своего CF socket adapter и Query origin.
 * Требуем все четыре кадра в правильном порядке: одиночное совпадение `nextWrite` не должно
 * превратить произвольную ошибку приложения в безопасный для повтора сетевой сбой.
 */
export function isConnectionError(err: unknown): boolean {
  if (err instanceof PostgresError || err instanceof HttpError) return false;
  if (typeof err !== "object" || err === null) return false;
  const code = (err as { code?: unknown }).code;
  if (typeof code === "string" && CONNECTION_ERROR_CODES.has(code)) return true;

  const stack = (err as { stack?: unknown }).stack;
  if (typeof stack !== "string") return false;
  let previousIndex = -1;
  for (const frame of CLOUDFLARE_POSTGRES_WRITE_FRAMES) {
    const index = stack.indexOf(frame, previousIndex + 1);
    if (index === -1) return false;
    previousIndex = index;
  }
  return true;
}

/**
 * Доступ к текущему клиенту вынесен в хуки (не напрямую к модульному `client`), чтобы
 * `withReconnect` можно было юнит-тестировать с фейковым клиентом без живой БД — тот же приём,
 * что и DI-параметр в `createRequireAuth` (middleware/auth.ts).
 */
export interface ClientHooks {
  get: () => Sql;
  set: (next: Sql) => void;
  create: () => Sql;
}

export interface ConnectionRetryOptions {
  /** Caller guarantees that repeating the standalone query is safe after an ambiguous failure. */
  retryConnectionErrors?: boolean;
}

/**
 * Пересоздаёт синглтон-клиента один раз на всех конкурентных вызывающих (single-flight) и явно
 * закрывает вытесняемого клиента. На Workers нельзя полагаться на то, что вытесненный клиент
 * закроется сам через `idle_timeout`: это голый `setTimeout` без `waitUntil`, а платформа не
 * гарантирует довыполнение таких таймеров после ответа на запрос, который завёл клиента.
 */
function reconnect(hooks: ClientHooks): Promise<void> {
  if (!reconnecting) {
    const stale = hooks.get();
    reconnecting = Promise.resolve()
      .then(() => {
        hooks.set(hooks.create());
      })
      .finally(() => {
        reconnecting = undefined;
        void stale?.end({ timeout: 0 });
      });
  }
  return reconnecting;
}

/**
 * Оборачивает клиента так, что при обрыве соединения он пересоздаётся. На Cloudflare
 * Workers сокет, закешированный в клиенте между запросами, может быть прибит платформой, пока
 * изолят простаивал без активного запроса — Postgres тогда видит на своей стороне «connection
 * reset by peer».
 *
 * По умолчанию standalone-запрос НЕ повторяется: transport-слой не знает, успел ли PostgreSQL
 * применить write до потери ack. Один повтор разрешается только явным opt-in вызывающего слоя,
 * который доказал read-only или идемпотентную семантику конкретной операции.
 *
 * Транзакции (`begin`) НЕ ретраятся: обрыв ровно на COMMIT неотличим от «сервер уже закоммитил,
 * ack потерян» (классическая неоднозначность транзакционного пулинга) — слепой повтор callback'а
 * мог бы продублировать уже применённые side-эффекты (например вставить вторую одинаковую
 * заявку обратной связи). Клиент всё равно чинится для следующего вызова, но сама ошибка
 * транзакции пробрасывается вызывающему коду как раньше — неоднозначность решается на уровне,
 * который знает, дошёл ли ответ (так уже сделано в `repos/requests.ts` через `clientRequestId`).
 */
export function withReconnect(
  hooks: ClientHooks,
  options: ConnectionRetryOptions = {},
): Sql {
  const target = hooks.get();
  return new Proxy(target, {
    apply(fn, thisArg, args) {
      // `sql(columns, ...keys)` (helper для динамических списков внутри другого запроса)
      // синхронный и не должен оборачиваться в Promise — ретраим только настоящие
      // tagged-template вызовы `sql\`...\`` (у них strings — массив с `.raw`).
      const isTaggedTemplate = Array.isArray((args[0] as { raw?: unknown } | undefined)?.raw);
      const result = Reflect.apply(fn, thisArg, args);
      if (!isTaggedTemplate) return result;
      return (async () => {
        try {
          return await result;
        } catch (err) {
          if (!isConnectionError(err)) throw err;
          await reconnect(hooks);
          if (!options.retryConnectionErrors) throw err;
          return await Reflect.apply(hooks.get(), thisArg, args);
        }
      })();
    },
    get(obj, prop, receiver) {
      const value = Reflect.get(obj, prop, receiver);
      if (prop !== "begin" || typeof value !== "function") return value;
      return async (...args: unknown[]) => {
        try {
          return await Reflect.apply(value, obj, args);
        } catch (err) {
          if (isConnectionError(err)) await reconnect(hooks);
          throw err;
        }
      };
    }
  });
}

/**
 * Ленивый синглтон клиента PostgreSQL (postgres.js), обёрнутый прозрачным реконнектом.
 * Работает и на Bun (локальная БД, по `DATABASE_URL`), и на Cloudflare Workers (по `HYPERDRIVE`
 * биндингу, если он есть — иначе тоже `DATABASE_URL`). `prepare: false` совместимо и с
 * transaction-mode Supavisor (локально/fallback), и с Hyperdrive поверх session-mode.
 */
function getClient(env: DatabaseEnv, options?: ConnectionRetryOptions): Sql {
  if (!client) {
    client = createClient(env);
  }
  return withReconnect({
    get: () => client!,
    set: (next) => {
      client = next;
    },
    create: () => createClient(env),
  }, options);
}

/**
 * Обычный DB capability: после connection error чинит singleton для следующего вызова, но
 * никогда скрыто не повторяет текущий standalone SQL.
 */
export function getDb(env: DatabaseEnv): Sql {
  return getClient(env);
}

/**
 * Явный capability только для read-only или идемпотентных standalone SQL. Транзакции даже через
 * этот client не повторяются: неоднозначность COMMIT должен разрешать доменный слой.
 */
export function getIdempotentDb(env: DatabaseEnv): Sql {
  return getClient(env, { retryConnectionErrors: true });
}

/** Завершает локальный singleton (используется только интеграционным harness и graceful shutdown). */
export async function closeDb(): Promise<void> {
  const current = client;
  client = undefined;
  reconnecting = undefined;
  if (current) await current.end({ timeout: 0 });
}
