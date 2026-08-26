import type { UploadContentType } from "@agromarket/contracts";
import type { TransactionSql } from "postgres";
import type { Database } from "../db";
import type { AppEnv } from "../env";
import { HttpError } from "../lib/errors";
import { appendAdminAuditIntent, type AdminAuditInput } from "./adminAudit";

export const UPLOAD_CLAIM_TTL_SECONDS = 15 * 60;

export async function createUploadClaim(
  env: AppEnv,
  input: { storagePath: string; issuerUserId: string; contentType: UploadContentType },
  db: Database,
  audit?: AdminAuditInput,
): Promise<void> {
  const sql = db.sql;
  await sql.begin(async (tx) => {
    await tx`
      insert into app_private.card_image_upload_claims (
        storage_path, issuer_user_id, content_type, expires_at
      ) values (
        ${input.storagePath}, ${input.issuerUserId}, ${input.contentType},
        now() + (${UPLOAD_CLAIM_TTL_SECONDS} * interval '1 second')
      )
    `;
    if (audit) await appendAdminAuditIntent(tx, audit);
  });
}

export async function markUploadClaimValidated(
  env: AppEnv,
  input: { storagePath: string; issuerUserId: string; contentType: UploadContentType },
  db: Database,
  audit?: AdminAuditInput,
): Promise<void> {
  const sql = db.sql;
  await sql.begin(async (tx) => {
    const rows = await tx`
      update app_private.card_image_upload_claims
      set validated_at = now()
      where storage_path = ${input.storagePath}
        and issuer_user_id = ${input.issuerUserId}
        and content_type = ${input.contentType}
        and consumed_at is null
        and expires_at > now()
      returning storage_path
    `;
    if (rows.length !== 1) throw new HttpError(409, "Срок подтверждения загрузки истёк. Загрузите фото заново.");
    if (audit) await appendAdminAuditIntent(tx, audit);
  });
}

/** Locks each newly referenced upload so it cannot be reused by another card or admin. */
export async function consumeUploadClaims(
  tx: TransactionSql,
  issuerUserId: string,
  storagePaths: string[],
): Promise<void> {
  if (storagePaths.length === 0) return;
  const uniquePaths = [...new Set(storagePaths)];
  const rows = await tx<{ storage_path: string }[]>`
    update app_private.card_image_upload_claims
    set consumed_at = now()
    where storage_path = any(${uniquePaths})
      and issuer_user_id = ${issuerUserId}
      and validated_at is not null
      and consumed_at is null
      and expires_at > now()
    returning storage_path
  `;
  if (rows.length !== uniquePaths.length) {
    throw new HttpError(409, "Одно или несколько фото не подтверждены или уже использованы. Загрузите их заново.");
  }
}
