import { z } from "zod";
import { createApp } from "./app";
import { createDatabaseInvocation, type DatabaseInvocation } from "./db";
import { resolveEnv, type AppEnv } from "./env";
import { runDbHealthAlertCheck } from "./lib/alerts";
import { reconcileAdminAuditOutbox } from "./lib/adminAuditOutbox";
import {
  processNotificationOutbox,
  reconcileNotificationOutbox,
} from "./lib/notificationOutbox";
import { runStorageCleanup } from "./lib/storageCleanup";
import { runStorageBackup } from "./lib/storageBackup";
import { purgeExpiredWidgetAuthProofs } from "./repos/authProofs";
import { runPrivacyRetention } from "./repos/privacy";
import { processTelegramUpdate } from "./repos/telegramUpdates";

export const NOTIFICATION_QUEUE_NAME = "agromarketkz-notifications-prod";
export const TELEGRAM_UPDATE_QUEUE_NAME = "agromarketkz-telegram-updates-prod";
export const FIVE_MINUTE_CRON = "*/5 * * * *";
export const DAILY_STORAGE_CRON = "0 3 * * *";
export const QUEUE_RETRY_DELAY_SECONDS = 60;

const notificationQueueMessageSchema = z.object({
  outboxId: z.uuid(),
}).strict();
const telegramUpdateQueueMessageSchema = z.object({
  updateId: z.number().int().nonnegative().safe(),
}).strict();

export interface QueueMessageLike {
  id: string;
  body: unknown;
  ack(): void;
  retry(options: { delaySeconds: number }): void;
}

export interface QueueBatchLike {
  queue: string;
  messages: readonly QueueMessageLike[];
}

export interface ScheduledContextLike {
  waitUntil(promise: Promise<unknown>): void;
}

export type WorkerDependencies = {
  resolveEnvironment: (env: WorkerEnv) => AppEnv;
  createDatabase: (env: AppEnv) => DatabaseInvocation;
  processNotification: (env: AppEnv, outboxId: string, db: DatabaseInvocation) => Promise<boolean>;
  processTelegramUpdate: (env: AppEnv, updateId: number, db: DatabaseInvocation) => Promise<boolean>;
  runDbHealthAlertCheck: (env: AppEnv, db: DatabaseInvocation) => Promise<void>;
  purgeExpiredWidgetAuthProofs: (env: AppEnv, db: DatabaseInvocation) => Promise<void>;
  reconcileAdminAuditOutbox: (env: AppEnv, db: DatabaseInvocation) => Promise<void>;
  reconcileNotificationOutbox: (env: AppEnv, db: DatabaseInvocation) => Promise<void>;
  runStorageCleanup: (env: AppEnv, db: DatabaseInvocation) => Promise<unknown>;
  runStorageBackup: (env: AppEnv) => Promise<unknown>;
  runPrivacyRetention: (env: AppEnv, db: DatabaseInvocation) => Promise<void>;
};

const productionDependencies: WorkerDependencies = {
  resolveEnvironment: (env) => resolveEnv(env, undefined),
  createDatabase: createDatabaseInvocation,
  processNotification: processNotificationOutbox,
  processTelegramUpdate,
  runDbHealthAlertCheck,
  purgeExpiredWidgetAuthProofs,
  reconcileAdminAuditOutbox,
  reconcileNotificationOutbox,
  runStorageCleanup,
  runStorageBackup,
  runPrivacyRetention,
};

function retry(message: QueueMessageLike, reason: string): void {
  console.error(reason, { messageId: message.id });
  message.retry({ delaySeconds: QUEUE_RETRY_DELAY_SECONDS });
}

/** Dispatches a Queue batch by its configured queue identity and strict envelope. */
export async function handleQueueBatch(
  batch: QueueBatchLike,
  env: WorkerEnv,
  dependencies: WorkerDependencies = productionDependencies,
): Promise<void> {
  const resolved = dependencies.resolveEnvironment(env);
  if (batch.queue !== NOTIFICATION_QUEUE_NAME && batch.queue !== TELEGRAM_UPDATE_QUEUE_NAME) {
    for (const message of batch.messages) retry(message, "queue batch has unknown identity");
    return;
  }

  const database = dependencies.createDatabase(resolved);
  for (const message of batch.messages) {
    try {
      if (batch.queue === TELEGRAM_UPDATE_QUEUE_NAME) {
        const parsed = telegramUpdateQueueMessageSchema.safeParse(message.body);
        if (!parsed.success) {
          retry(message, "telegram update queue message has invalid envelope");
          continue;
        }
        const processed = await dependencies.processTelegramUpdate(resolved, parsed.data.updateId, database);
        if (processed) message.ack();
        else retry(message, "telegram update queue message remains pending");
        continue;
      }

      const parsed = notificationQueueMessageSchema.safeParse(message.body);
      if (!parsed.success) {
        retry(message, "notification queue message has invalid envelope");
        continue;
      }
      const delivered = await dependencies.processNotification(resolved, parsed.data.outboxId, database);
      if (delivered) message.ack();
      else retry(message, "notification queue message remains pending");
    } catch (error) {
      console.error("queue message processing failed", { messageId: message.id, error });
      message.retry({ delaySeconds: QUEUE_RETRY_DELAY_SECONDS });
    }
  }
}

type NamedJob = readonly [name: string, run: () => Promise<unknown>];

async function runScheduledJobs(jobs: readonly NamedJob[]): Promise<void> {
  const results = await Promise.allSettled(jobs.map(([, run]) => run()));
  const failures = results.flatMap((result, index) => result.status === "rejected"
    ? [`${jobs[index]![0]}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`]
    : []);
  if (failures.length > 0) throw new Error(`scheduled jobs failed: ${failures.join("; ")}`);
}

/** Registers one fully tracked scheduled invocation; unknown crons never run a fallback job. */
export function handleScheduled(
  event: Pick<ScheduledController, "cron">,
  env: WorkerEnv,
  ctx: ScheduledContextLike,
  dependencies: WorkerDependencies = productionDependencies,
): void {
  let jobs: NamedJob[];
  if (event.cron === FIVE_MINUTE_CRON) {
    const resolved = dependencies.resolveEnvironment(env);
    const database = dependencies.createDatabase(resolved);
    jobs = [
      ["db-health-alert", () => dependencies.runDbHealthAlertCheck(resolved, database)],
      ["widget-auth-proof-retention", () => dependencies.purgeExpiredWidgetAuthProofs(resolved, database)],
      ["admin-audit-outbox-reconcile", () => dependencies.reconcileAdminAuditOutbox(resolved, database)],
      ["notification-outbox-reconcile", () => dependencies.reconcileNotificationOutbox(resolved, database)],
    ];
  } else if (event.cron === DAILY_STORAGE_CRON) {
    const resolved = dependencies.resolveEnvironment(env);
    const database = dependencies.createDatabase(resolved);
    jobs = [
      ["storage-cleanup", () => dependencies.runStorageCleanup(resolved, database)],
      ["storage-backup", () => dependencies.runStorageBackup(resolved)],
      ["privacy-retention", () => dependencies.runPrivacyRetention(resolved, database)],
    ];
  } else {
    ctx.waitUntil(Promise.resolve().then(() => {
      throw new Error(`unsupported scheduled cron: ${event.cron}`);
    }));
    return;
  }

  const completion = runScheduledJobs(jobs).catch((error) => {
    console.error("scheduled runtime failed", { cron: event.cron, error });
    throw error;
  });
  ctx.waitUntil(completion);
}

const app = createApp({ disposeDatabase: false });

export default {
  fetch: app.fetch,
  scheduled(event, env: WorkerEnv, ctx) {
    handleScheduled(event, env, ctx);
  },
  async queue(batch, env: WorkerEnv) {
    await handleQueueBatch(batch, env);
  },
} satisfies ExportedHandler<WorkerEnv>;
