import type { PaginationQuery, Profile } from "@agromarket/contracts";
import { getDb } from "../db";
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
export async function findByTelegramId(env: AppEnv, telegramId: number): Promise<UserRow | undefined> {
  const sql = getDb(env);
  const [row] = await sql<UserRow[]>`
    select * from users where telegram_id = ${telegramId} limit 1
  `;
  return row;
}

/**
 * Создаёт пользователя или обновляет ЗЕРКАЛО Telegram (username/имя/фамилия).
 * Контактные поля (`contact_*`, `registered_at`) НЕ трогает — они источник правды.
 */
export async function upsertFromTelegram(env: AppEnv, tg: TelegramUser): Promise<UserRow> {
  const sql = getDb(env);
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
  data: { contactName: string; contactPhone: string }
): Promise<UserRow> {
  const sql = getDb(env);
  const [row] = await sql<UserRow[]>`
    update users set
      contact_name = ${data.contactName},
      contact_phone = ${data.contactPhone},
      registered_at = coalesce(registered_at, now())
    where id = ${userId}
    returning *
  `;
  return row!;
}

/** Обновление контактных данных в профиле (без сброса `registered_at`). */
export async function updateContacts(
  env: AppEnv,
  userId: string,
  data: { contactName: string; contactPhone: string }
): Promise<UserRow> {
  const sql = getDb(env);
  const [row] = await sql<UserRow[]>`
    update users set
      contact_name = ${data.contactName},
      contact_phone = ${data.contactPhone}
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
export async function setVerifiedPhone(env: AppEnv, userId: string, phone: string): Promise<void> {
  const sql = getDb(env);
  await sql`update users set verified_phone = ${phone} where id = ${userId}`;
}

/** Зарегистрированные пользователи (админ) — база собранных контактов, новые сверху. */
export async function listRegisteredUsers(
  env: AppEnv,
  query: PaginationQuery
): Promise<PaginatedResult<Profile>> {
  const sql = getDb(env);
  const rows = await sql<UserRow[]>`
    select * from users
    where registered_at is not null
    order by created_at desc
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
