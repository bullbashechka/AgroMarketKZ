import type { Context } from "hono";
import { isConnectionError } from "../db";
import { getDatabase, getEnv, type HonoEnv } from "../env";
import { processAdminAuditOutbox } from "./adminAuditOutbox";
import { HttpError } from "./errors";
import {
  enqueueAdminAuditEvent,
  type AdminAuditInput,
  type AdminAuditOutcome,
} from "../repos/adminAudit";

const AUDITED_MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function shouldAudit(method: string, path: string): boolean {
  const canonicalPath = path.toLowerCase();
  const readsPii = method === "GET" && (
    canonicalPath === "/admin/users"
    || canonicalPath === "/admin/requests"
    || /^\/admin\/requests\/[0-9a-f-]+$/.test(canonicalPath)
  );
  return readsPii || AUDITED_MUTATION_METHODS.has(method);
}

function requestTarget(path: string): { target: string; targetType: string; targetId?: string } {
  // Hono and Zod accept uppercase UUID route parameters. Keep the audit
  // classification and event identity canonical so casing cannot bypass a
  // PII-read audit or create action variants.
  const canonicalPath = path.toLowerCase();
  const target = canonicalPath
    .replace(/^\/admin\//, "")
    .replace(/\/[0-9a-f-]+(?=\/|$)/g, "/:id");
  return {
    target,
    targetType: target.split("/")[0] ?? "admin",
    targetId: canonicalPath.match(/[0-9a-f]{8}-[0-9a-f-]{27,}/)?.[0],
  };
}

export function auditOutcome(status: number): AdminAuditOutcome {
  if (status === 401 || status === 403) return "denied";
  return status >= 400 ? "failed" : "success";
}

export function buildAdminAuditInput(
  c: Context<HonoEnv>,
  outcome: AdminAuditOutcome,
  status = c.res.status,
): AdminAuditInput | undefined {
  if (!shouldAudit(c.req.method, c.req.path)) return undefined;
  const actor = c.get("auth");
  if (!actor) return undefined;
  const target = requestTarget(c.req.path);
  const requestId = c.get("requestId");
  return {
    eventId: requestId,
    actor,
    requestId,
    action: `${c.req.method.toLowerCase()}:${target.target}`,
    targetType: target.targetType,
    targetId: target.targetId,
    outcome,
    metadata: { status },
  };
}

function errorKind(error: unknown): string {
  return error instanceof Error && error.name ? error.name : typeof error;
}

/**
 * Executes an admin mutation whose repository writes the audit intent inside
 * its business transaction. Immediate finalization is only an optimization;
 * the committed outbox remains the recovery source of truth.
 */
export async function runAdminMutation<T>(
  c: Context<HonoEnv>,
  successStatus: number,
  mutate: (audit: AdminAuditInput) => Promise<T>,
): Promise<T> {
  const audit = buildAdminAuditInput(c, "success", successStatus);
  if (!audit) return mutate({
    actor: c.get("auth"),
    requestId: c.get("requestId"),
    action: "unknown",
    targetType: "admin",
    outcome: "success",
    metadata: { status: successStatus },
  });

  const result = await mutate(audit);
  c.set("adminAuditCommitted", true);
  try {
    const finalized = await processAdminAuditOutbox(getEnv(c), audit.eventId!, getDatabase(c));
    if (!finalized) {
      console.error("admin audit finalization deferred", {
        event: "admin_audit_finalization_deferred",
        requestId: audit.requestId,
      });
    }
  } catch (error) {
    // The mutation and intent are already committed. Recovery cron owns the
    // remaining delivery state and the response must not claim a rollback.
    console.error("admin audit finalization failed", {
      event: "admin_audit_finalization_failed",
      requestId: audit.requestId,
      connectionError: isConnectionError(error),
      errorKind: errorKind(error),
    });
  }
  return result;
}

/** Durable fallback for denials, validation errors, and failed handlers. */
export async function auditAdminRequest(c: Context<HonoEnv>, status: number): Promise<void> {
  const audit = buildAdminAuditInput(c, auditOutcome(status), status);
  if (!audit) return;
  try {
    await enqueueAdminAuditEvent(getEnv(c), audit, getDatabase(c));
    try {
      await processAdminAuditOutbox(getEnv(c), audit.eventId!, getDatabase(c));
    } catch (error) {
      console.error("admin audit recovery dispatch failed", {
        event: "admin_audit_recovery_dispatch_failed",
        requestId: audit.requestId,
        errorKind: errorKind(error),
      });
    }
  } catch (error) {
    // This path is only for requests that never committed a mutation. A
    // denial/failure without a durable intent cannot be reconstructed by cron,
    // so fail closed instead of returning an unaudited admin response.
    console.error("admin audit durable intent unavailable", {
      event: "admin_audit_intent_unavailable",
      requestId: audit.requestId,
      connectionError: isConnectionError(error),
      errorKind: errorKind(error),
    });
    throw new HttpError(503, "Аудит административного действия временно недоступен");
  }
}
