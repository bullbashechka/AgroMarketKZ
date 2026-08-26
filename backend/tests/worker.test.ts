import { describe, expect, test } from "bun:test";
import { createApp } from "../src/app";
import type { DatabaseInvocation } from "../src/db";
import type { AppEnv } from "../src/env";
import {
  DAILY_STORAGE_CRON,
  FIVE_MINUTE_CRON,
  handleQueueBatch,
  handleScheduled,
  NOTIFICATION_QUEUE_NAME,
  TELEGRAM_UPDATE_QUEUE_NAME,
  type QueueMessageLike,
  type ScheduledContextLike,
  type WorkerDependencies,
} from "../src/worker";

const env = {} as WorkerEnv;
const resolvedEnv = { WEBAPP_ORIGIN: "https://app.example" } as AppEnv;
const database = {} as DatabaseInvocation;
const outboxId = "4ef66e67-9c95-4fd5-9f05-a08a2d2a7bd9";

const productionProxyEnv: AppEnv = {
  APP_ENV: "production",
  WEBAPP_ORIGIN: "https://app.example",
  PAGES_PROXY_SECRET: "p".repeat(32),
  ADMIN_ALLOWLIST: "1",
  ADMIN_OWNER_TELEGRAM_ID: "1",
  TELEGRAM_BOT_TOKEN: "t".repeat(20),
  TELEGRAM_WEBHOOK_SECRET: "w".repeat(20),
  HYPERDRIVE: { connectionString: "postgres://unused" } as Hyperdrive,
  SUPABASE_URL: "https://supabase.example",
  SUPABASE_STORAGE_BUCKET: "card-images",
  SUPABASE_SERVICE_ROLE_KEY: "s".repeat(20),
  API_READ_RATE_LIMITER: { limit: async () => ({ success: true }) },
  API_MUTATION_RATE_LIMITER: { limit: async () => ({ success: true }) },
  AUTH_RATE_LIMITER: { limit: async () => ({ success: true }) },
  AUTH_IDENTITY_RATE_LIMITER: { limit: async () => ({ success: true }) },
  NOTIFICATION_QUEUE: { send: async () => {} },
  TELEGRAM_UPDATE_QUEUE: { send: async () => {} },
};

function dependencies(overrides: Partial<WorkerDependencies> = {}): WorkerDependencies {
  return {
    resolveEnvironment: () => resolvedEnv,
    createDatabase: () => database,
    processNotification: async () => true,
    processTelegramUpdate: async () => true,
    runDbHealthAlertCheck: async () => {},
    purgeExpiredWidgetAuthProofs: async () => {},
    reconcileNotificationOutbox: async () => {},
    runStorageCleanup: async () => {},
    runStorageBackup: async () => {},
    runPrivacyRetention: async () => {},
    ...overrides,
  };
}

function message(id: string, body: unknown): QueueMessageLike & { actions: string[] } {
  const actions: string[] = [];
  return {
    id,
    body,
    actions,
    ack: () => actions.push("ack"),
    retry: ({ delaySeconds }) => actions.push(`retry:${delaySeconds}`),
  };
}

function scheduledContext(): ScheduledContextLike & { promises: Promise<unknown>[] } {
  const promises: Promise<unknown>[] = [];
  return { promises, waitUntil: (promise) => promises.push(promise) };
}

function recordValue(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be a TOML table`);
  }
  return value as Record<string, unknown>;
}

function recordArray(value: unknown, label: string): Record<string, unknown>[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be a TOML array`);
  return value.map((entry, index) => recordValue(entry, `${label}[${index}]`));
}

function stringValue(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} must be a string`);
  return value;
}

function stringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be a TOML array`);
  return value.map((entry, index) => stringValue(entry, `${label}[${index}]`));
}

async function readWranglerConfig(): Promise<{ source: string; config: Record<string, unknown> }> {
  const source = await Bun.file(new URL("../wrangler.toml", import.meta.url)).text();
  return {
    source,
    config: recordValue(Bun.TOML.parse(source), "backend/wrangler.toml"),
  };
}

describe("Worker Queue contract", () => {
  test("uses queue identity and strict envelope before dispatching", async () => {
    const valid = message("valid", { outboxId });
    const invalid = message("invalid", { updateId: 7 });
    const processed: string[] = [];

    await handleQueueBatch({ queue: NOTIFICATION_QUEUE_NAME, messages: [invalid, valid] }, env, dependencies({
      processNotification: async (_env, id) => {
        processed.push(id);
        return true;
      },
    }));

    expect(invalid.actions).toEqual(["retry:60"]);
    expect(valid.actions).toEqual(["ack"]);
    expect(processed).toEqual([outboxId]);
  });

  test("continues after a failing message and retries only that message", async () => {
    const failed = message("failed", { updateId: 11 });
    const next = message("next", { updateId: 12 });
    const processed: number[] = [];

    await handleQueueBatch({ queue: TELEGRAM_UPDATE_QUEUE_NAME, messages: [failed, next] }, env, dependencies({
      processTelegramUpdate: async (_env, updateId) => {
        processed.push(updateId);
        if (updateId === 11) throw new Error("temporary failure");
        return true;
      },
    }));

    expect(failed.actions).toEqual(["retry:60"]);
    expect(next.actions).toEqual(["ack"]);
    expect(processed).toEqual([11, 12]);
  });

  test("retries unknown queue identities without creating a database invocation", async () => {
    const unknown = message("unknown", { outboxId });
    let created = false;

    await handleQueueBatch({ queue: "untrusted-queue", messages: [unknown] }, env, dependencies({
      createDatabase: () => {
        created = true;
        return database;
      },
    }));

    expect(unknown.actions).toEqual(["retry:60"]);
    expect(created).toBe(false);
  });
});

describe("Worker configuration contract", () => {
  test("keeps Worker queue names and cron strings aligned with Wrangler", async () => {
    const { source, config } = await readWranglerConfig();
    const queues = recordValue(config.queues, "queues");
    const producers = recordArray(queues.producers, "queues.producers");
    const consumers = recordArray(queues.consumers, "queues.consumers");
    const triggers = recordValue(config.triggers, "triggers");
    const workerQueueNames = [NOTIFICATION_QUEUE_NAME, TELEGRAM_UPDATE_QUEUE_NAME];

    expect(source).toContain(`queue = "${NOTIFICATION_QUEUE_NAME}"`);
    expect(source).toContain(`queue = "${TELEGRAM_UPDATE_QUEUE_NAME}"`);
    expect(source).toContain(`"${FIVE_MINUTE_CRON}"`);
    expect(source).toContain(`"${DAILY_STORAGE_CRON}"`);

    const producerQueueNames = producers.map((producer, index) => stringValue(
      producer.queue,
      `queues.producers[${index}].queue`,
    ));
    const consumerQueueNames = consumers.map((consumer, index) => stringValue(
      consumer.queue,
      `queues.consumers[${index}].queue`,
    ));
    const producerQueuesByBinding = Object.fromEntries(producers.map((producer, index) => [
      stringValue(producer.binding, `queues.producers[${index}].binding`),
      stringValue(producer.queue, `queues.producers[${index}].queue`),
    ]));

    expect(producerQueueNames.sort()).toEqual([...workerQueueNames].sort());
    expect(consumerQueueNames.sort()).toEqual([...workerQueueNames].sort());
    expect(producerQueuesByBinding).toEqual({
      NOTIFICATION_QUEUE: NOTIFICATION_QUEUE_NAME,
      TELEGRAM_UPDATE_QUEUE: TELEGRAM_UPDATE_QUEUE_NAME,
    });
    expect(stringArray(triggers.crons, "triggers.crons").sort()).toEqual([
      DAILY_STORAGE_CRON,
      FIVE_MINUTE_CRON,
    ].sort());
  });
});

describe("Pages-to-Worker proxy protocol", () => {
  test("accepts legacy and version 1 proxy requests, but rejects an explicit unknown version", async () => {
    const app = createApp({
      env: productionProxyEnv,
      createDatabaseInvocation: () => database,
    });
    const headers = { "X-Agromarket-Proxy": productionProxyEnv.PAGES_PROXY_SECRET! };

    const legacy = await app.request("/__runtime-contract", { headers });
    const current = await app.request("/__runtime-contract", {
      headers: { ...headers, "X-Agromarket-Proxy-Version": "1" },
    });
    const unsupported = await app.request("/__runtime-contract", {
      headers: { ...headers, "X-Agromarket-Proxy-Version": "2" },
    });

    expect(legacy.status).toBe(404);
    expect(current.status).toBe(404);
    expect(unsupported.status).toBe(401);
  });
});

describe("Worker scheduled contract", () => {
  test("routes each configured cron to exactly its own jobs", async () => {
    const calls: string[] = [];
    const deps = dependencies({
      runDbHealthAlertCheck: async () => { calls.push("health"); },
      purgeExpiredWidgetAuthProofs: async () => { calls.push("proofs"); },
      reconcileNotificationOutbox: async () => { calls.push("outbox"); },
      runStorageCleanup: async () => { calls.push("cleanup"); },
      runStorageBackup: async () => { calls.push("backup"); },
      runPrivacyRetention: async () => { calls.push("privacy"); },
    });
    const frequent = scheduledContext();
    handleScheduled({ cron: FIVE_MINUTE_CRON }, env, frequent, deps);
    await frequent.promises[0];
    expect(calls).toEqual(["health", "proofs", "outbox"]);

    calls.length = 0;
    const daily = scheduledContext();
    handleScheduled({ cron: DAILY_STORAGE_CRON }, env, daily, deps);
    await daily.promises[0];
    expect(calls).toEqual(["cleanup", "backup", "privacy"]);
  });

  test("waitUntil remains pending until every started job settles and then reports named failures", async () => {
    let release: (() => void) | undefined;
    const deferred = new Promise<void>((resolve) => { release = resolve; });
    const calls: string[] = [];
    const ctx = scheduledContext();
    handleScheduled({ cron: FIVE_MINUTE_CRON }, env, ctx, dependencies({
      runDbHealthAlertCheck: async () => {
        calls.push("health");
        await deferred;
      },
      purgeExpiredWidgetAuthProofs: async () => {
        calls.push("proofs");
        throw new Error("proof cleanup failed");
      },
      reconcileNotificationOutbox: async () => { calls.push("outbox"); },
    }));

    let settled = false;
    void ctx.promises[0].then(
      () => { settled = true; },
      () => { settled = true; },
    );
    await Promise.resolve();
    expect(settled).toBe(false);
    release?.();
    await expect(ctx.promises[0]).rejects.toThrow("widget-auth-proof-retention: proof cleanup failed");
    expect(calls).toEqual(["health", "proofs", "outbox"]);
  });

  test("rejects an unknown cron without running fallback maintenance", async () => {
    let created = false;
    const ctx = scheduledContext();
    handleScheduled({ cron: "* * * * *" }, env, ctx, dependencies({
      createDatabase: () => {
        created = true;
        return database;
      },
    }));

    expect(created).toBe(false);
    expect(ctx.promises).toHaveLength(1);
    await expect(ctx.promises[0]).rejects.toThrow("unsupported scheduled cron");
  });
});
