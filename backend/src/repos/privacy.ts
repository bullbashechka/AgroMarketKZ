import { getDb } from "../db";
import type { AppEnv } from "../env";
import { HttpError } from "../lib/errors";

/**
 * Irreversibly removes direct identifiers while preserving only anonymised
 * marketplace aggregates. The retained user row has a non-routable negative
 * Telegram id, so a later Telegram login creates a fresh account.
 */
export async function deleteAccount(env: AppEnv, userId: string): Promise<void> {
  const sql = getDb(env);
  await sql.begin(async (tx) => {
    const [hold] = await tx<{ user_id: string }[]>`
      select user_id from app_private.privacy_holds where user_id = ${userId} for update
    `;
    if (hold) {
      throw new HttpError(409, "Удаление временно недоступно из-за юридического хранения данных");
    }

    const [user] = await tx<{ id: string }[]>`
      select id from public.users where id = ${userId} and deleted_at is null for update
    `;
    if (!user) throw new HttpError(404, "Пользователь не найден");

    await tx`
      update app_private.user_sessions
      set revoked_at = now()
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
export async function runPrivacyRetention(env: AppEnv): Promise<void> {
  const sql = getDb(env);
  await sql`
    delete from app_private.card_image_upload_claims
    where expires_at < now() - interval '1 day'
  `;
  await sql`
    delete from app_private.user_sessions
    where expires_at < now() - interval '30 days'
       or (revoked_at is not null and revoked_at < now() - interval '30 days')
  `;
  await sql`
    delete from public.users u
    where u.registered_at is null
      and u.deleted_at is null
      and u.created_at < now() - interval '30 days'
      and not exists (select 1 from app_private.privacy_holds h where h.user_id = u.id)
      and not exists (select 1 from public.requests r where r.user_id = u.id)
      and not exists (select 1 from public.feedback_messages f where f.user_id = u.id)
  `;
  await sql`
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
  await sql`
    update public.feedback_messages f
    set contact_name = '[удалено]',
        contact_phone = '[удалено]',
        contact_phone_verified = false,
        message = '[удалено]'
    where f.created_at < now() - interval '180 days'
      and f.contact_name <> '[удалено]'
      and not exists (select 1 from app_private.privacy_holds h where h.user_id = f.user_id)
  `;
  const inactive = await sql<{ id: string }[]>`
    select u.id
    from public.users u
    where u.deleted_at is null
      and u.last_seen_at < now() - interval '24 months'
      and not exists (select 1 from app_private.privacy_holds h where h.user_id = u.id)
    order by u.last_seen_at
    limit 100
  `;
  for (const user of inactive) await deleteAccount(env, user.id);
}
