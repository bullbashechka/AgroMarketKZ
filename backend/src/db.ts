import postgres, { type Sql } from "postgres";
import type { AppEnv } from "./env";

let client: Sql | undefined;

export const POSTGRES_POOL_OPTIONS = Object.freeze({
  max: 3,
  idle_timeout: 20,
  connect_timeout: 10,
  prepare: false,
}) satisfies postgres.Options<{}>;

/**
 * Ленивый синглтон клиента PostgreSQL (postgres.js).
 * Работает и на Bun (локальная БД), и на Cloudflare Workers — единый код-путь по `DATABASE_URL`.
 * `prepare: false` совместимо с пуллером Supabase (transaction mode).
 */
export function getDb(env: AppEnv): Sql {
  if (!client) {
    client = postgres(env.DATABASE_URL, POSTGRES_POOL_OPTIONS);
  }
  return client;
}
