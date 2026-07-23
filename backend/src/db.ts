import postgres, { type Sql } from "postgres";
import { HttpError } from "./lib/errors";
import type { AppEnv } from "./env";

const { PostgresError } = postgres;

let client: Sql | undefined;

export const POSTGRES_POOL_OPTIONS = Object.freeze({
  max: 3,
  idle_timeout: 20,
  connect_timeout: 10,
  prepare: false,
}) satisfies postgres.Options<{}>;

function createClient(env: AppEnv): Sql {
  return postgres(env.DATABASE_URL, POSTGRES_POOL_OPTIONS);
}

/**
 * `PostgresError`/`HttpError` — осмысленные ошибки самого запроса/бизнес-логики, ретраить их
 * нельзя (например 409 из транзакции). Всё остальное, долетевшее сюда из postgres.js, на практике
 * означает обрыв сокета — на Workers это ожидаемо (см. `withReconnect`).
 */
export function isConnectionError(err: unknown): boolean {
  return !(err instanceof PostgresError) && !(err instanceof HttpError);
}

/**
 * Оборачивает клиента так, что при обрыве соединения он молча пересоздаётся и операция
 * повторяется один раз. На Cloudflare Workers сокет, закешированный в клиенте между запросами,
 * может быть прибит платформой, пока изолят простаивал без активного запроса — Postgres тогда
 * видит на своей стороне «connection reset by peer», а следующий запрос (уже в новом изоляте
 * или с тем же клиентом) падает сетевой ошибкой ДО того, как что-то реально выполнилось на
 * сервере. Заранее проверить живость сокета нельзя, поэтому лечим постфактум одним ретраем.
 */
function withReconnect(env: AppEnv): Sql {
  const target = client!;
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
          client = createClient(env);
          return await Reflect.apply(client, thisArg, args);
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
          if (!isConnectionError(err)) throw err;
          client = createClient(env);
          return await Reflect.apply(client.begin, client, args);
        }
      };
    }
  });
}

/**
 * Ленивый синглтон клиента PostgreSQL (postgres.js), обёрнутый прозрачным реконнектом.
 * Работает и на Bun (локальная БД), и на Cloudflare Workers — единый код-путь по `DATABASE_URL`.
 * `prepare: false` совместимо с пуллером Supabase (transaction mode).
 */
export function getDb(env: AppEnv): Sql {
  if (!client) {
    client = createClient(env);
  }
  return withReconnect(env);
}
