import type { Database, IdempotentDatabase } from "../db";
import type { AppEnv } from "../env";
import {
  appendAdminAuditEvent,
  type AdminAuditOutcome,
} from "../repos/adminAudit";

export const MAX_ADMIN_AUDIT_ATTEMPTS = 20;
export const ADMIN_AUDIT_LEASE_SECONDS = 10 * 60;

interface AdminAuditOutboxRow {
  id: string;
  actor_user_id: string | null;
  actor_telegram_id: string;
  request_id: string;
  action: string;
  target_type: string;
  target_id: string | null;
  outcome: AdminAuditOutcome;
  metadata: Record<string, string | number | boolean | null>;
  attempts: number;
  processing_token: string;
}

interface OutboxState {
  status: "pending" | "processing" | "sent" | "dead_letter";
  processing_at: Date | null;
  next_attempt_at: Date;
}

const MAX_RETRY_DELAY_SECONDS = 60 * 60;

function retryDelaySeconds(attempts: number): number {
  return Math.min(MAX_RETRY_DELAY_SECONDS, Math.max(30, 2 ** Math.min(attempts, 10)));
}

function errorKind(error: unknown): string {
  if (typeof error !== "object" || error === null) {
    return typeof error;
  }
  const source = error as {
    name?: unknown;
    code?: unknown;
    constraint?: unknown;
    constraint_name?: unknown;
  };
  const name = typeof source.name === "string" && source.name ? source.name : "Error";
  const code = typeof source.code === "string" && source.code ? ` code=${source.code}` : "";
  const constraintValue = source.constraint ?? source.constraint_name;
  const constraint = typeof constraintValue === "string" && constraintValue
    ? ` constraint=${constraintValue}`
    : "";
  return `${name}${code}${constraint}`.slice(0, 500);
}

async function readOutboxState(outboxId: string, db: Database): Promise<OutboxState | undefined> {
  const [state] = await db.sql<OutboxState[]>`
    select status, processing_at, next_attempt_at
    from app_private.admin_audit_outbox
    where id = ${outboxId}
  `;
  return state;
}

async function markExhausted(outboxId: string, db: Database): Promise<boolean> {
  const rows = await db.sql<{ id: string; attempts: number }[]>`
    update app_private.admin_audit_outbox
    set status = 'dead_letter',
        processing_at = null,
        processing_token = null,
        dead_lettered_at = coalesce(dead_lettered_at, now()),
        last_error = coalesce(last_error, 'maximum retry attempts exceeded')
    where id = ${outboxId}
      and attempts >= ${MAX_ADMIN_AUDIT_ATTEMPTS}
      and (
        status = 'pending'
        or (status = 'processing' and (
          processing_at is null
          or processing_at < now() - (${ADMIN_AUDIT_LEASE_SECONDS} * interval '1 second')
        ))
      )
    returning id, attempts
  `;
  if (rows.length === 0) return false;
  console.error("admin audit outbox dead-lettered", {
    event: "admin_audit_outbox_dead_letter",
    outboxId,
    attempts: rows[0]!.attempts,
    reason: "maximum retry attempts exceeded",
  });
  return true;
}

async function claimAdminAuditOutbox(
  outboxId: string,
  db: Database,
): Promise<AdminAuditOutboxRow | undefined> {
  const processingToken = crypto.randomUUID();
  const [row] = await db.sql<AdminAuditOutboxRow[]>`
    update app_private.admin_audit_outbox
    set status = 'processing',
        attempts = attempts + 1,
        processing_at = now(),
        processing_token = ${processingToken}
    where id = ${outboxId}
      and attempts < ${MAX_ADMIN_AUDIT_ATTEMPTS}
      and (
        (status = 'pending' and next_attempt_at <= now())
        or (status = 'processing' and (
          processing_at is null
          or processing_at < now() - (${ADMIN_AUDIT_LEASE_SECONDS} * interval '1 second')
        ))
      )
    returning id, actor_user_id, actor_telegram_id, request_id, action,
      target_type, target_id, outcome, metadata, attempts, processing_token
  `;
  return row;
}

async function markSent(outboxId: string, processingToken: string, db: Database): Promise<boolean> {
  const rows = await db.sql<{ id: string }[]>`
    update app_private.admin_audit_outbox
    set status = 'sent',
        sent_at = now(),
        processing_at = null,
        processing_token = null,
        last_error = null
    where id = ${outboxId}
      and status = 'processing'
      and processing_token = ${processingToken}
    returning id
  `;
  return rows.length === 1;
}

async function markFailure(
  outboxId: string,
  processingToken: string,
  attempts: number,
  error: unknown,
  db: Database,
): Promise<boolean> {
  const status = attempts >= MAX_ADMIN_AUDIT_ATTEMPTS ? "dead_letter" : "pending";
  const summary = errorKind(error);
  const rows = await db.sql<{ id: string; status: string }[]>`
    update app_private.admin_audit_outbox
    set status = ${status},
        processing_at = null,
        processing_token = null,
        next_attempt_at = now() + (${retryDelaySeconds(attempts)} * interval '1 second'),
        last_error = ${summary},
        dead_lettered_at = case when ${status} = 'dead_letter' then coalesce(dead_lettered_at, now()) else null end
    where id = ${outboxId}
      and status = 'processing'
      and processing_token = ${processingToken}
    returning id, status
  `;
  if (rows.length !== 1) return false;
  if (status === "dead_letter") {
    console.error("admin audit outbox dead-lettered", {
      event: "admin_audit_outbox_dead_letter",
      outboxId,
      attempts,
      lastError: summary,
    });
  }
  return true;
}

/** Processes one claimed event; false leaves it durable for the next retry. */
export async function processAdminAuditOutbox(
  env: AppEnv,
  outboxId: string,
  db: Database,
): Promise<boolean> {
  if (await markExhausted(outboxId, db)) return true;
  const outbox = await claimAdminAuditOutbox(outboxId, db);
  if (!outbox) {
    const state = await readOutboxState(outboxId, db);
    if (!state || state.status === "sent" || state.status === "dead_letter") return true;
    // A fresh lease or a backoff row is unfinished work. The caller must not
    // acknowledge a delivery merely because another worker owns it.
    return false;
  }

  try {
    await appendAdminAuditEvent(env, {
      eventId: outbox.id,
      actor: {
        userId: outbox.actor_user_id,
        telegramId: Number(outbox.actor_telegram_id),
        isRegistered: false,
      },
      requestId: outbox.request_id,
      action: outbox.action,
      targetType: outbox.target_type,
      targetId: outbox.target_id ?? undefined,
      outcome: outbox.outcome,
      metadata: outbox.metadata,
    }, db);
    const finalized = await markSent(outbox.id, outbox.processing_token, db);
    if (!finalized) {
      console.error("admin audit outbox lease lost before sent", {
        event: "admin_audit_outbox_lease_lost",
        outboxId: outbox.id,
      });
    }
    return finalized;
  } catch (error) {
    const updated = await markFailure(outbox.id, outbox.processing_token, outbox.attempts, error, db);
    if (!updated) {
      console.error("admin audit outbox lease lost before failure update", {
        event: "admin_audit_outbox_lease_lost",
        outboxId: outbox.id,
        errorKind: errorKind(error),
      });
    }
    return false;
  }
}

async function deadLetterExhaustedRows(db: IdempotentDatabase): Promise<void> {
  const rows = await db.retryIdempotentStandalone<{ id: string; attempts: number }[]>`
    update app_private.admin_audit_outbox
    set status = 'dead_letter',
        processing_at = null,
        processing_token = null,
        dead_lettered_at = coalesce(dead_lettered_at, now()),
        last_error = coalesce(last_error, 'maximum retry attempts exceeded')
    where status in ('pending', 'processing')
      and attempts >= ${MAX_ADMIN_AUDIT_ATTEMPTS}
      and (
        status = 'pending'
        or (status = 'processing' and (
          processing_at is null
          or processing_at < now() - (${ADMIN_AUDIT_LEASE_SECONDS} * interval '1 second')
        ))
      )
    returning id, attempts
  `;
  for (const row of rows) {
    console.error("admin audit outbox dead-lettered", {
      event: "admin_audit_outbox_dead_letter",
      outboxId: row.id,
      attempts: row.attempts,
      reason: "maximum retry attempts exceeded",
    });
  }
}

/** Reconciles pending and abandoned processing rows from the existing cron. */
export async function reconcileAdminAuditOutbox(
  env: AppEnv,
  db: IdempotentDatabase,
): Promise<number> {
  await deadLetterExhaustedRows(db);
  const rows = await db.retryIdempotentStandalone<Pick<AdminAuditOutboxRow, "id">[]>`
    select id
    from app_private.admin_audit_outbox
    where (
      status = 'pending' and next_attempt_at <= now()
    ) or (
      status = 'processing' and (
        processing_at is null
        or processing_at < now() - (${ADMIN_AUDIT_LEASE_SECONDS} * interval '1 second')
      )
    )
    order by created_at
    limit 50
  `;
  for (const row of rows) {
    await processAdminAuditOutbox(env, row.id, db).catch((error) => {
      console.error("admin audit outbox reconcile failed", {
        event: "admin_audit_outbox_reconcile_failed",
        outboxId: row.id,
        errorKind: errorKind(error),
      });
    });
  }
  return rows.length;
}

/** Operator recovery: explicitly reopens one terminal poison row. */
export async function requeueAdminAuditOutbox(outboxId: string, db: Database): Promise<boolean> {
  const rows = await db.sql<{ id: string }[]>`
    update app_private.admin_audit_outbox
    set status = 'pending',
        attempts = 0,
        next_attempt_at = now(),
        processing_at = null,
        processing_token = null,
        dead_lettered_at = null,
        last_error = null,
        sent_at = null
    where id = ${outboxId} and status = 'dead_letter'
    returning id
  `;
  return rows.length === 1;
}
