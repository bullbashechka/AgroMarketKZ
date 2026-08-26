import type { TransactionSql } from "postgres";
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
 * Audit history is append-only: a physically deleted unregistered user is
 * allowed to leave audit rows behind, with only the nullable relational actor
 * link cleared by the audit FK's ON DELETE SET NULL action. Registered users
 * are retained as anonymised tombstones so historical foreign keys remain
 * useful without retaining their direct identifiers.
 */
interface RetentionCandidate {
  id: string;
}

/**
 * Locks the user before each destructive retention action. A concurrent legal
 * hold takes KEY SHARE in its trigger, so it either wins before this check or
 * waits until this transaction has completed without an active hold.
 */
async function retainUserData(userId: string, db: Database): Promise<void> {
  await db.sql.begin(async (tx: TransactionSql) => {
    const [user] = await tx<{ id: string }[]>`
      select id from public.users where id = ${userId} and deleted_at is null for update
    `;
    if (!user) return;
    const [hold] = await tx<{ user_id: string }[]>`
      select user_id from app_private.privacy_holds where user_id = ${userId} for update
    `;
    if (hold) return;
    await tx`
      update public.requests
      set contact_name = '[удалено]', contact_phone = '[удалено]',
          contact_phone_verified = false, comment = '[удалено]'
      where user_id = ${userId} and status = 'closed'
        and updated_at < now() - interval '180 days' and contact_name <> '[удалено]'
    `;
    await tx`
      update public.feedback_messages
      set contact_name = '[удалено]', contact_phone = '[удалено]',
          contact_phone_verified = false, message = '[удалено]'
      where user_id = ${userId} and created_at < now() - interval '180 days'
        and contact_name <> '[удалено]'
    `;
    await tx`
      delete from public.users u
      where u.id = ${userId} and u.registered_at is null
        and u.created_at < now() - interval '30 days'
        and not exists (select 1 from public.requests r where r.user_id = u.id)
        and not exists (select 1 from public.feedback_messages f where f.user_id = u.id)
    `;
  });
}

export async function runPrivacyRetention(env: AppEnv, db: IdempotentDatabase): Promise<void> {
  // Only standalone cleanup and candidate discovery are retried. Per-user
  // PII changes use a transaction and must never be replayed after a transport
  // ambiguity.
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
  const retentionCandidates = await db.retryIdempotentStandalone<RetentionCandidate[]>`
    select u.id
    from public.users u
    where u.deleted_at is null
      and (
        (
          u.registered_at is null
          and u.created_at < now() - interval '30 days'
          and not exists (select 1 from public.requests r where r.user_id = u.id)
          and not exists (select 1 from public.feedback_messages f where f.user_id = u.id)
        )
        or exists (
          select 1 from public.requests r
          where r.user_id = u.id and r.status = 'closed'
            and r.updated_at < now() - interval '180 days'
            and r.contact_name <> '[удалено]'
        )
        or exists (
          select 1 from public.feedback_messages f
          where f.user_id = u.id and f.created_at < now() - interval '180 days'
            and f.contact_name <> '[удалено]'
        )
      )
    order by u.created_at
    limit 100
  `;
  for (const user of retentionCandidates) await retainUserData(user.id, db);
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
