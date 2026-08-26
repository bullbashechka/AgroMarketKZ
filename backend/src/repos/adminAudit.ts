import type { Database } from "../db";
import type { AppEnv, AuthUser } from "../env";

export interface AdminAuditInput {
  actor: AuthUser;
  requestId: string;
  action: string;
  targetType: string;
  targetId?: string;
  outcome?: "success" | "denied" | "failed";
  metadata?: Record<string, string | number | boolean | null>;
}

/** Metadata is scalar-only: never persist request bodies, credentials or PII. */
export async function appendAdminAuditEvent(env: AppEnv, input: AdminAuditInput, db: Database): Promise<void> {
  const sql = db.sql;
  await sql`
    insert into app_private.admin_audit_events (
      actor_user_id, actor_telegram_id, request_id, action, target_type,
      target_id, outcome, metadata
    )
    values (
      ${input.actor.userId}, ${input.actor.telegramId}, ${input.requestId}, ${input.action},
      ${input.targetType}, ${input.targetId ?? null}, ${input.outcome ?? "success"},
      ${sql.json(input.metadata ?? {})}
    )
  `;
}
