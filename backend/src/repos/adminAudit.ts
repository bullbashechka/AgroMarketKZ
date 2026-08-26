import type { TransactionSql } from "postgres";
import type { Database, IdempotentDatabase } from "../db";
import type { AppEnv, AuthUser } from "../env";

export type AdminAuditOutcome = "success" | "denied" | "failed";

export interface AdminAuditActor {
  userId: string | null;
  telegramId: number;
  isRegistered: boolean;
}

export interface AdminAuditInput {
  actor: AuthUser | AdminAuditActor;
  /** Stable event identity shared by the transactional intent and recovery. */
  eventId?: string;
  requestId: string;
  action: string;
  targetType: string;
  targetId?: string;
  outcome?: AdminAuditOutcome;
  metadata?: Record<string, string | number | boolean | null>;
}

function normalizedInput(input: AdminAuditInput) {
  return {
    eventId: input.eventId ?? input.requestId,
    actor: input.actor,
    requestId: input.requestId,
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId ?? null,
    outcome: input.outcome ?? "success",
    metadata: input.metadata ?? {},
  };
}

/**
 * Writes only the durable delivery intent. The caller must execute this with
 * the same transaction that changes the business row; no external side effect
 * belongs in that transaction.
 */
export async function appendAdminAuditIntent(tx: TransactionSql, input: AdminAuditInput): Promise<void> {
  const event = normalizedInput(input);
  await tx`
    insert into app_private.admin_audit_outbox (
      id, actor_user_id, actor_telegram_id, request_id, action, target_type,
      target_id, outcome, metadata
    )
    values (
      ${event.eventId}, ${event.actor.userId}, ${event.actor.telegramId}, ${event.requestId},
      ${event.action}, ${event.targetType}, ${event.targetId}, ${event.outcome},
      ${tx.json(event.metadata)}
    )
    on conflict (id) do nothing
  `;
}

/** Metadata is scalar-only: never persist request bodies, credentials or PII. */
export async function appendAdminAuditEvent(env: AppEnv, input: AdminAuditInput, db: Database): Promise<void> {
  const event = normalizedInput(input);
  const sql = db.sql;
  await sql`
    insert into app_private.admin_audit_events (
      id, actor_user_id, actor_telegram_id, request_id, action, target_type,
      target_id, outcome, metadata
    )
    values (
      ${event.eventId}, ${event.actor.userId}, ${event.actor.telegramId}, ${event.requestId}, ${event.action},
      ${event.targetType}, ${event.targetId}, ${event.outcome}, ${sql.json(event.metadata)}
    )
    on conflict (id) do nothing
  `;
}

/**
 * Stores the exact PII-free event for scheduled retry. The stable primary key
 * makes an ambiguous insert safe to retry explicitly; no audit event is updated
 * or deleted.
 */
export async function enqueueAdminAuditEvent(
  env: AppEnv,
  input: AdminAuditInput,
  db: IdempotentDatabase,
): Promise<void> {
  const event = normalizedInput(input);
  await db.retryIdempotentStandalone`
    insert into app_private.admin_audit_outbox (
      id, actor_user_id, actor_telegram_id, request_id, action, target_type,
      target_id, outcome, metadata
    )
    values (
      ${event.eventId}, ${event.actor.userId}, ${event.actor.telegramId}, ${event.requestId},
      ${event.action}, ${event.targetType}, ${event.targetId}, ${event.outcome},
      ${db.sql.json(event.metadata)}
    )
    on conflict (id) do nothing
  `;
}
