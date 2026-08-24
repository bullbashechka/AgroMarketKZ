import { createHash, randomUUID } from "node:crypto";

/** Telegram accepts ids in this range, while the large range keeps test identities isolated. */
const TELEGRAM_ID_BASE = 900_000_000_000;
const TELEGRAM_ID_RANGE = 99_000_000_000;
const MAX_OFFSET = 1_000;
const SAFE_RUN_ID = /^[A-Za-z0-9-]{1,32}$/;

/**
 * Resolves the run id without lossy sanitization. An explicit value must be
 * safe as-is so two different raw values can never silently share a cleanup
 * prefix or Telegram identity namespace.
 */
export function resolveE2ERunId(requestedRunId: string | undefined): string {
  if (requestedRunId !== undefined) {
    if (!SAFE_RUN_ID.test(requestedRunId)) {
      throw new Error("E2E_RUN_ID must contain only 1-32 ASCII letters, digits, or hyphens");
    }
    return requestedRunId;
  }

  return randomUUID().replaceAll("-", "").slice(0, 32);
}

/** Derives a stable, per-run Telegram id from an explicit test/fixture identity. */
export function telegramIdFor(runId: string, identity: string, offset = 0): number {
  if (!SAFE_RUN_ID.test(runId)) {
    throw new Error("Cannot derive an E2E Telegram id without a safe E2E_RUN_ID");
  }
  if (!identity.trim()) {
    throw new Error("Cannot derive an E2E Telegram id without a stable identity");
  }
  if (!Number.isInteger(offset) || offset < 0 || offset >= MAX_OFFSET) {
    throw new Error("E2E Telegram id offset is out of range");
  }

  const hash = Number.parseInt(
    createHash("sha256").update(`${runId}\u0000${identity}`).digest("hex").slice(0, 12),
    16,
  );
  return TELEGRAM_ID_BASE + (hash % (TELEGRAM_ID_RANGE - MAX_OFFSET)) + offset;
}

