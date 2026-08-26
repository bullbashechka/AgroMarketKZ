import type { Database, IdempotentDatabase } from "../db";
import type { AppEnv } from "../env";
import { HttpError } from "../lib/errors";
import { telegramIdentityHash } from "../lib/telegram";
import {
  advanceTelegramAuthCutoff,
  lockTelegramIdentity,
} from "./telegramAuthCutoff";

/**
 * Irreversibly removes direct identifiers while preserving only anonymised
 * marketplace aggregates. The retained user row has a non-routable negative
 * Telegram id, so a later Telegram login creates a fresh account.
 */
export async function deleteAccount(env: AppEnv, userId: string, db: Database): Promise<void> {
  const sql = db.sql;
  const [hold] = await sql<{ user_id: string }[]>`
    select user_id from app_private.privacy_holds where user_id = ${userId}
  `;
  if (hold) {
    throw new HttpError(409, "Удаление временно недоступно из-за юридического хранения данных");
  }
  const [candidate] = await sql<{ telegram_id: string }[]>`
    select telegram_id
    from public.users
    where id = ${userId} and deleted_at is null
  `;
  if (!candidate) throw new HttpError(404, "Пользователь не найден");
  const identityHash = await telegramIdentityHash(Number(candidate.telegram_id), env.TELEGRAM_BOT_TOKEN);

  await sql.begin(async (tx) => {
    // Locking the parent row serializes this transaction with a concurrent
    // privacy_holds insert, whose foreign-key check takes a KEY SHARE lock.
    const [user] = await tx<{ id: string }[]>`
      select id from public.users where id = ${userId} and deleted_at is null for update
    `;
    if (!user) throw new HttpError(404, "Пользователь не найден");

    const [lockedHold] = await tx<{ user_id: string }[]>`
      select user_id from app_private.privacy_holds where user_id = ${userId} for update
    `;
    if (lockedHold) {
      throw new HttpError(409, "Удаление временно недоступно из-за юридического хранения данных");
    }

    await lockTelegramIdentity(tx, identityHash);
    await advanceTelegramAuthCutoff(tx, identityHash);
    await tx`
      update app_private.user_sessions
      set revoked_at = clock_timestamp()
      where user_id = ${userId} and revoked_at is null
    `;
    await tx`delete from public.favorites where user_id = ${userId}`;
    await tx`
      update public.requests
      set contact_name = '[удалено]',
          contact_phone = '[удалено]',
          contact_phone_verified = false,
          comment = '[удалено]',
          status = 'closed'
      where user_id = ${userId}
    `;
    await tx`
      update public.feedback_messages
      set contact_name = '[удалено]',
          contact_phone = '[удалено]',
          contact_phone_verified = false,
          message = '[удалено]'
      where user_id = ${userId}
    `;
    await tx`
      update public.users
      set telegram_id = -telegram_id,
          telegram_username = null,
          telegram_first_name = null,
          telegram_last_name = null,
          contact_name = null,
          contact_phone = null,
          verified_phone = null,
          registered_at = null,
          deleted_at = now(),
          updated_at = now()
      where id = ${userId}
    `;
  });
}

/**
 * Daily retention job. Legal holds are checked in every destructive predicate;
 * PII is anonymised before deleting an inactive account record's identifiers.
 */
export async function runPrivacyRetention(env: AppEnv, db: IdempotentDatabase): Promise<void> {
  // Все standalone statements ниже — повторяемые DELETE/absolute anonymisation UPDATE или SELECT.
  // deleteAccount() использует отдельную транзакцию через обычный db.sql и никогда не ретраится.
  await db.retryIdempotentStandalone`
    delete from app_private.card_image_upload_claims
    where expires_at < now() - interval '1 day'
  `;
  await db.retryIdempotentStandalone`
    delete from app_private.user_sessions
    where expires_at < now() - interval '30 days'
       or (revoked_at is not null and revoked_at < now() - interval '30 days')
  `;
  await db.retryIdempotentStandalone`
    delete from app_private.telegram_auth_cutoffs
    where expires_at < now()
  `;
  await db.retryIdempotentStandalone`
    delete from public.users u
    where u.registered_at is null
      and u.deleted_at is null
      and u.created_at < now() - interval '30 days'
      and not exists (select 1 from app_private.privacy_holds h where h.user_id = u.id)
      and not exists (select 1 from public.requests r where r.user_id = u.id)
      and not exists (select 1 from public.feedback_messages f where f.user_id = u.id)
  `;
  await db.retryIdempotentStandalone`
    update public.requests r
    set contact_name = '[удалено]',
        contact_phone = '[удалено]',
        contact_phone_verified = false,
        comment = '[удалено]'
    where r.status = 'closed'
      and r.updated_at < now() - interval '180 days'
      and r.contact_name <> '[удалено]'
      and not exists (select 1 from app_private.privacy_holds h where h.user_id = r.user_id)
  `;
  await db.retryIdempotentStandalone`
    update public.feedback_messages f
    set contact_name = '[удалено]',
        contact_phone = '[удалено]',
        contact_phone_verified = false,
        message = '[удалено]'
    where f.created_at < now() - interval '180 days'
      and f.contact_name <> '[удалено]'
      and not exists (select 1 from app_private.privacy_holds h where h.user_id = f.user_id)
  `;
  const inactive = await db.retryIdempotentStandalone<{ id: string }[]>`
    select u.id
    from public.users u
    where u.deleted_at is null
      and u.last_seen_at < now() - interval '24 months'
      and not exists (select 1 from app_private.privacy_holds h where h.user_id = u.id)
    order by u.last_seen_at
    limit 100
  `;
  for (const user of inactive) await deleteAccount(env, user.id, db);
}
