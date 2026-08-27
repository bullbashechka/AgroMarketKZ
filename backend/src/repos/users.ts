import type { PaginationQuery, Profile } from "@agromarket/contracts";
import type { Database } from "../db";
import type { AppEnv } from "../env";
import { isAdmin } from "../lib/admin";
import { paginateRows, type PaginatedResult } from "../lib/pagination";

/** Строка таблицы `users` (нужные поля; postgres.js может вернуть и лишние ключи). */
export interface UserRow {
  id: string;
  telegram_id: string; // bigint приходит строкой
  telegram_username: string | null;
  telegram_first_name: string | null;
  telegram_last_name: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  verified_phone: string | null;
  token_version: number;
  registered_at: Date | null;
  created_at: Date;
}

/** Данные пользователя из Telegram (Mini App `initData` или Login Widget). */
export interface TelegramUser {
  id: number;
  username?: string | null;
  firstName?: string | null;
  lastName?: string | null;
}

/** Находит пользователя по Telegram id. */
export async function findByTelegramId(env: AppEnv, telegramId: number, db: Database): Promise<UserRow | undefined> {
  const sql = db.sql;
  const [row] = await sql<UserRow[]>`
    select * from users where telegram_id = ${telegramId} limit 1
  `;
  return row;
}

/** Минимальная живая запись для проверки JWT без повторного SELECT в requireRegistered. */
export async function findAuthUser(
  env: AppEnv,
  userId: string,
  telegramId: number,
  db: Database,
): Promise<{ tokenVersion: number; isRegistered: boolean } | undefined> {
  const sql = db.sql;
  const [row] = await sql<{ token_version: number; registered_at: Date | null }[]>`
    select token_version, registered_at
    from users
    where id = ${userId} and telegram_id = ${telegramId}
    limit 1
  `;
  if (!row) return undefined;
  return { tokenVersion: row.token_version, isRegistered: row.registered_at !== null };
}

const AUTH_CACHE_TTL_SECONDS = 60; // KV-минимум expirationTtl.
const authCacheKey = (userId: string) => `authuser:v1:${userId}`;

interface AuthCacheEntry {
  tokenVersion: number;
  isRegistered: boolean;
}

/**
 * Обёртка над findAuthUser с кешем в Workers KV (см. TASKS.md, Этап 13 №4). Ключ — только
 * userId, без telegramId: пара (id, telegram_id) в users неизменна после создания строки, а
 * запись в кеш происходит только после того, как findAuthUser уже подтвердил эту пару в WHERE.
 * Без AUTH_CACHE_KV (локальный Bun) деградирует к прямому SELECT.
 */
export async function findAuthUserCached(
  env: AppEnv,
  userId: string,
  telegramId: number,
  db: Database,
): Promise<{ tokenVersion: number; isRegistered: boolean } | undefined> {
  const kv = env.AUTH_CACHE_KV;
  // Session revocation is a security boundary. Cache use must be an explicit
  // capacity choice; production defaults to a live DB read so token_version
  // changes take effect immediately even if KV invalidation is delayed.
  if (!kv || env.AUTH_CACHE_MODE === "disabled") return findAuthUser(env, userId, telegramId, db);

  const key = authCacheKey(userId);
  const cached = await kv.get<AuthCacheEntry>(key, "json").catch(() => null);
  if (cached && typeof cached.tokenVersion === "number" && typeof cached.isRegistered === "boolean") {
    return cached;
  }

  const fresh = await findAuthUser(env, userId, telegramId, db);
  if (fresh) {
    kv.put(key, JSON.stringify(fresh), { expirationTtl: AUTH_CACHE_TTL_SECONDS }).catch(() => {});
  }
  return fresh;
}

async function invalidateAuthCache(env: AppEnv, userId: string): Promise<void> {
  if (!env.AUTH_CACHE_KV) return;
  await env.AUTH_CACHE_KV.delete(authCacheKey(userId)).catch(() => {});
}

/** Атомарно отзывает все JWT пользователя, выпущенные до текущей версии сессии. */
export async function revokeUserSessions(env: AppEnv, userId: string, db: Database): Promise<boolean> {
  const sql = db.sql;
  const rows = await sql<{ id: string }[]>`
    update users
    set token_version = token_version + 1
    where id = ${userId}
    returning id
  `;
  const revoked = rows.length === 1;
  if (revoked) await invalidateAuthCache(env, userId);
  return revoked;
}

/**
 * Создаёт пользователя или обновляет ЗЕРКАЛО Telegram (username/имя/фамилия).
 * Контактные поля (`contact_*`, `registered_at`) НЕ трогает — они источник правды.
 */
export async function upsertFromTelegram(env: AppEnv, tg: TelegramUser, db: Database): Promise<UserRow> {
  const sql = db.sql;
  const [row] = await sql<UserRow[]>`
    insert into users (telegram_id, telegram_username, telegram_first_name, telegram_last_name)
    values (${tg.id}, ${tg.username ?? null}, ${tg.firstName ?? null}, ${tg.lastName ?? null})
    on conflict (telegram_id) do update set
      telegram_username = excluded.telegram_username,
      telegram_first_name = excluded.telegram_first_name,
      telegram_last_name = excluded.telegram_last_name
    returning *
  `;
  return row!;
}

/** Регистрация: сохраняет имя+телефон и проставляет `registered_at`. */
export async function register(
  env: AppEnv,
  userId: string,
  data: { contactName: string; contactPhone: string },
  db: Database,
  verifiedPhone: string | null = null,
): Promise<UserRow> {
  const sql = db.sql;
  const [row] = await sql<UserRow[]>`
    update users set
      contact_name = ${data.contactName},
      contact_phone = ${data.contactPhone},
      verified_phone = case
        when ${verifiedPhone}::text = ${data.contactPhone} then ${data.contactPhone}
        else verified_phone
      end,
      registered_at = coalesce(registered_at, now())
    where id = ${userId}
    returning *
  `;
  await invalidateAuthCache(env, userId);
  return row!;
}

/** Обновление контактных данных в профиле (без сброса `registered_at`). */
export async function updateContacts(
  env: AppEnv,
  userId: string,
  data: { contactName: string; contactPhone: string },
  db: Database,
  verifiedPhone: string | null = null,
): Promise<UserRow> {
  const sql = db.sql;
  const [row] = await sql<UserRow[]>`
    update users set
      contact_name = ${data.contactName},
      contact_phone = ${data.contactPhone},
      verified_phone = case
        when ${verifiedPhone}::text = ${data.contactPhone} then ${data.contactPhone}
        else verified_phone
      end
    where id = ${userId}
    returning *
  `;
  return row!;
}

/**
 * Сохраняет телефон, подтверждённый подписанным контактом Telegram (E.164).
 * «Телефон подтверждён» далее — производное сравнение contact_phone = verified_phone,
 * поэтому редактирование номера ничего сбрасывать не должно.
 */
/** Зарегистрированные пользователи (админ) — база собранных контактов, новые сверху. */
export async function listRegisteredUsers(
  env: AppEnv,
  query: PaginationQuery,
  db: Database,
): Promise<PaginatedResult<Profile>> {
  const sql = db.sql;
  const rows = await sql<UserRow[]>`
    select * from users
    where registered_at is not null
    order by created_at desc, id
    limit ${query.limit + 1} offset ${query.offset}
  `;
  const items = rows.map((row) => toProfile(row, env));
  return paginateRows(items, query.limit, query.offset);
}

/** Маппинг строки БД в DTO профиля. `isRegistered`/`isAdmin` вычисляются. */
export function toProfile(row: UserRow, env: AppEnv): Profile {
  const telegramId = Number(row.telegram_id);
  return {
    id: row.id,
    telegramId,
    telegramUsername: row.telegram_username,
    telegramFirstName: row.telegram_first_name,
    telegramLastName: row.telegram_last_name,
    contactName: row.contact_name,
    contactPhone: row.contact_phone,
    phoneVerified: row.contact_phone !== null && row.contact_phone === row.verified_phone,
    isRegistered: row.registered_at !== null,
    registeredAt: row.registered_at ? row.registered_at.toISOString() : null,
    isAdmin: isAdmin(telegramId, env),
    createdAt: row.created_at.toISOString()
  };
}
