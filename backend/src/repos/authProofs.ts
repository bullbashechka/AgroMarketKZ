import { getDb } from "../db";
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
): Promise<void> {
  const sql = getDb(env);
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
export async function purgeExpiredWidgetAuthProofs(env: AppEnv): Promise<number> {
  const sql = getDb(env);
  const rows = await sql<{ proof_hash: string }[]>`
    delete from app_private.widget_auth_proofs
    where expires_at < now() - interval '1 hour'
    returning proof_hash
  `;
  return rows.length;
}
