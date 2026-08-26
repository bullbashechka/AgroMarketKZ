import { createApp } from "./app";
import { createDatabaseInvocation } from "./db";
import { resolveEnv, type AppEnv } from "./env";
import { runDbHealthAlertCheck } from "./lib/alerts";
import {
  processNotificationOutbox,
  reconcileNotificationOutbox,
  type NotificationQueueMessage,
} from "./lib/notificationOutbox";
import { runStorageCleanup } from "./lib/storageCleanup";
import { runStorageBackup } from "./lib/storageBackup";
import { purgeExpiredWidgetAuthProofs } from "./repos/authProofs";
import { runPrivacyRetention } from "./repos/privacy";
import { processTelegramUpdate } from "./repos/telegramUpdates";

type WorkerQueueMessage = NotificationQueueMessage | { updateId: number };

function isTelegramUpdateMessage(body: WorkerQueueMessage): body is { updateId: number } {
  return "updateId" in body && typeof body.updateId === "number";
}

function isNotificationMessage(body: WorkerQueueMessage): body is NotificationQueueMessage {
  return "outboxId" in body && typeof body.outboxId === "string";
}

const app = createApp({ disposeDatabase: false });

export default {
  fetch: app.fetch,
  async scheduled(event, env: WorkerEnv, ctx) {
    const resolved = resolveEnv(env, undefined);
    const database = createDatabaseInvocation(resolved);
    if (event.cron === "*/5 * * * *") {
      ctx.waitUntil(Promise.all([
        runDbHealthAlertCheck(resolved, database),
        purgeExpiredWidgetAuthProofs(resolved, database),
        reconcileNotificationOutbox(resolved, database),
      ]).catch((error) => {
        console.error("scheduled maintenance failed", error);
      }));
    } else {
      ctx.waitUntil(Promise.all([
        runStorageCleanup(resolved, database),
        runStorageBackup(resolved),
        runPrivacyRetention(resolved, database),
      ]).catch((error) => {
        console.error("scheduled storage maintenance failed", error);
      }));
    }
  },
  async queue(batch, env) {
    const resolved = resolveEnv(env, undefined);
    const database = createDatabaseInvocation(resolved);
    for (const message of batch.messages) {
      try {
        if (!message.body) {
          console.error("queue message has no body", { messageId: message.id });
          message.retry({ delaySeconds: 60 });
          continue;
        }
        if (isTelegramUpdateMessage(message.body)) {
          const processed = await processTelegramUpdate(resolved, message.body.updateId, database);
          if (processed) message.ack();
          else message.retry({ delaySeconds: 60 });
          continue;
        }
        if (!isNotificationMessage(message.body)) {
          console.error("queue message has invalid shape", { messageId: message.id });
          message.retry({ delaySeconds: 60 });
          continue;
        }
        const delivered = await processNotificationOutbox(resolved, message.body.outboxId, database);
        if (delivered) {
          message.ack();
        } else {
          // The durable outbox remains pending; Queue retries and eventually
          // moves the event to the configured DLQ for operator inspection.
          message.retry({ delaySeconds: 60 });
        }
      } catch (error) {
        console.error("notification queue processing failed", { messageId: message.id, error });
        message.retry({ delaySeconds: 60 });
      }
    }
  }
} satisfies ExportedHandler<WorkerEnv, WorkerQueueMessage>;
