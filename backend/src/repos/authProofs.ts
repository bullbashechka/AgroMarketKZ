import type { Sql, TransactionSql } from "postgres";
import type { Database, IdempotentDatabase } from "../db";
import type { AppEnv } from "../env";
import { HttpError } from "../lib/errors";

const encoder = new TextEncoder();

async function proofDigest(proofHash: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(proofHash));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Atomically consumes a Telegram Login Widget proof. The HMAC hash is already
 * authenticated by validateWidgetLogin; storing only a digest in a unique table
 * makes a captured redirect one-use even inside the five-minute freshness window
 * without retaining the bearer proof verbatim.
 */
export async function consumeWidgetAuthProof(
  env: AppEnv,
  proofHash: string,
  telegramId: number,
  authDate: number,
  db: Database,
): Promise<void> {
  await consumeWidgetAuthProofWithSql(db.sql, proofHash, telegramId, authDate);
}

/** Same one-use proof operation for a transaction that also creates the session. */
export async function consumeWidgetAuthProofInTransaction(
  proofHash: string,
  telegramId: number,
  authDate: number,
  tx: TransactionSql,
): Promise<void> {
  await consumeWidgetAuthProofWithSql(tx, proofHash, telegramId, authDate);
}

async function consumeWidgetAuthProofWithSql(
  sql: Sql | TransactionSql,
  proofHash: string,
  telegramId: number,
  authDate: number,
): Promise<void> {
  const storedProofHash = await proofDigest(proofHash);
  const [inserted] = await sql`
    insert into app_private.widget_auth_proofs (
      proof_hash, telegram_id, auth_date, expires_at, consumed_at
    ) values (
      ${storedProofHash}, ${telegramId}, to_timestamp(${authDate}),
      to_timestamp(${authDate + 5 * 60}), now()
    )
    on conflict (proof_hash) do nothing
    returning proof_hash
  `;
  if (!inserted) {
    throw new HttpError(401, "Ссылка входа Telegram уже использована");
  }
}

/** Удаляет только давно истёкшие одноразовые proofs; вызывается из cron. */
export async function purgeExpiredWidgetAuthProofs(env: AppEnv, db: IdempotentDatabase): Promise<void> {
  // DELETE по фиксированному cutoff идемпотентен; cleanup не публикует неоднозначный row count.
  await db.retryIdempotentStandalone`
    delete from app_private.widget_auth_proofs
    where expires_at < now() - interval '1 hour'
  `;
}
