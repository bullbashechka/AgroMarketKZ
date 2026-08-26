import type { TransactionSql } from "postgres";
import { HttpError } from "../lib/errors";

/** Keep the cutoff while every valid Mini App proof issued before it expires. */
export const TELEGRAM_AUTH_CUTOFF_RETENTION_SECONDS = 25 * 60 * 60;

/** Serialize exchange and full revocation for one HMAC-derived Telegram identity. */
export async function lockTelegramIdentity(tx: TransactionSql, identityHash: string): Promise<void> {
  await tx`select pg_advisory_xact_lock(hashtextextended(${identityHash}, 0))`;
}

/** Reject a verified Mini App proof issued at or before the latest cutoff. */
export async function assertTelegramAuthAllowed(
  tx: TransactionSql,
  identityHash: string,
  authDate: number,
): Promise<void> {
  const [clock] = await tx<{ db_now: string }[]>`
    select floor(extract(epoch from clock_timestamp()))::bigint as db_now
  `;
  if (!clock || authDate > Number(clock.db_now)) {
    throw new HttpError(401, "Данные авторизации Telegram устарели, откройте приложение заново");
  }

  const [cutoff] = await tx<{ auth_not_before: string }[]>`
    select auth_not_before
    from app_private.telegram_auth_cutoffs
    where identity_hash = ${identityHash}
      and expires_at > clock_timestamp()
  `;
  if (cutoff && authDate <= Number(cutoff.auth_not_before)) {
    throw new HttpError(401, "Данные авторизации Telegram отозваны, откройте приложение заново");
  }
}

/** Advance a cutoff using database time; callers must hold the identity lock. */
export async function advanceTelegramAuthCutoff(
  tx: TransactionSql,
  identityHash: string,
): Promise<void> {
  await tx`
    insert into app_private.telegram_auth_cutoffs (
      identity_hash, auth_not_before, expires_at, updated_at
    ) values (
      ${identityHash},
      floor(extract(epoch from clock_timestamp()))::bigint,
      clock_timestamp() + (${TELEGRAM_AUTH_CUTOFF_RETENTION_SECONDS} * interval '1 second'),
      clock_timestamp()
    )
    on conflict (identity_hash) do update set
      auth_not_before = greatest(
        app_private.telegram_auth_cutoffs.auth_not_before,
        excluded.auth_not_before
      ),
      expires_at = greatest(
        app_private.telegram_auth_cutoffs.expires_at,
        excluded.expires_at
      ),
      updated_at = clock_timestamp()
  `;
}
