import { afterAll, expect, test } from "bun:test";
import { createApp } from "../src/app";
import { createDatabaseInvocation, type DatabaseInvocation } from "../src/db";
import type { AppEnv } from "../src/env";
import {
  processAdminAuditOutbox,
  reconcileAdminAuditOutbox,
  requeueAdminAuditOutbox,
} from "../src/lib/adminAuditOutbox";
import { createUserSession } from "../src/repos/sessions";
import { enqueueAdminAuditEvent } from "../src/repos/adminAudit";
import {
  describeIntegration,
  integrationEnv,
  openIntegrationDatabase,
  openIntegrationSql,
} from "./integrationTestDatabase";

interface Actor {
  id: string;
  telegramId: number;
  token: string;
}

describeIntegration("admin audit durability", () => {
  const sql = openIntegrationSql();
  let telegramSequence = 0;

  function nextTelegramId(): number {
    telegramSequence += 1;
    return 8_400_000_000 + telegramSequence;
  }

  async function createActor(label: string, registered = false): Promise<Actor> {
    const actor: Actor = { id: crypto.randomUUID(), telegramId: nextTelegramId(), token: "" };
    await sql`
      insert into public.users (
        id, telegram_id, telegram_first_name, contact_name, contact_phone, registered_at
      )
      values (
        ${actor.id}, ${actor.telegramId}, ${`[td-003b] ${label}`},
        ${registered ? `PII Secret Name ${label}` : null},
        ${registered ? "+77005554433" : null},
        ${registered ? new Date().toISOString() : null}
      )
    `;
    const db = openIntegrationDatabase();
    try {
      actor.token = await createUserSession(integrationEnv, actor.id, db);
    } finally {
      await db.dispose();
    }
    return actor;
  }

  async function cleanupActor(actor: Actor): Promise<void> {
    await sql`delete from app_private.admin_audit_outbox where actor_user_id = ${actor.id}`;
    await sql`delete from app_private.admin_audit_events where actor_user_id = ${actor.id}`;
    await sql`delete from public.users where id = ${actor.id}`;
  }

  function adminEnv(actor: Actor, allowlist = actor.telegramId): AppEnv {
    return { ...integrationEnv, ADMIN_ALLOWLIST: String(allowlist) };
  }

  function databaseFailingFor(env: AppEnv, queryFragment: string): DatabaseInvocation {
    const real = createDatabaseInvocation(env);
    const queryMatches = (args: unknown[]): boolean => {
      const strings = args[0] as { raw?: readonly string[] } | undefined;
      return Array.isArray(strings?.raw) && strings.raw.join("").includes(queryFragment);
    };
    const transactionProxy = (transaction: object) => new Proxy(transaction, {
      apply(target, thisArg, args) {
        if (queryMatches(args)) {
          throw new Error(`injected integration failure for ${queryFragment}`);
        }
        return Reflect.apply(target as (...queryArgs: unknown[]) => unknown, thisArg, args);
      },
    });
    const sql = new Proxy(real.sql, {
      apply(target, thisArg, args) {
        if (queryMatches(args)) {
          throw new Error(`injected integration failure for ${queryFragment}`);
        }
        return Reflect.apply(target, thisArg, args);
      },
      get(target, property, receiver) {
        const value = Reflect.get(target, property, receiver);
        if (property !== "begin" || typeof value !== "function") return value;
        return (...args: unknown[]) => {
          const callbackIndex = typeof args[0] === "function" ? 0 : 1;
          const callback = args[callbackIndex];
          if (typeof callback !== "function") return Reflect.apply(value, target, args);
          const nextArgs = [...args];
          nextArgs[callbackIndex] = (transaction: object) => Reflect.apply(
            callback,
            undefined,
            [transactionProxy(transaction)],
          );
          return Reflect.apply(value, target, nextArgs);
        };
      },
    });
    return {
      sql,
      retryIdempotentStandalone: real.retryIdempotentStandalone,
      dispose: real.dispose,
    };
  }

  function databaseUnavailableAfterCommit(env: AppEnv): DatabaseInvocation {
    const real = createDatabaseInvocation(env);
    let unavailable = false;
    const sql = new Proxy(real.sql, {
      apply(target, thisArg, args) {
        if (unavailable) throw new Error("simulated outage after mutation commit");
        return Reflect.apply(target, thisArg, args);
      },
      get(target, property, receiver) {
        const value = Reflect.get(target, property, receiver);
        if (property !== "begin" || typeof value !== "function") return value;
        return async (...args: unknown[]) => {
          await Reflect.apply(value, target, args);
          unavailable = true;
          throw new Error("simulated process termination after mutation commit");
        };
      },
    });
    return {
      sql,
      retryIdempotentStandalone: async <T = unknown>(
        strings: TemplateStringsArray,
        ...values: unknown[]
      ): Promise<T> => {
        if (unavailable) throw new Error("simulated outage after mutation commit");
        return real.retryIdempotentStandalone<T>(strings, ...values);
      },
      dispose: real.dispose,
    };
  }

  async function readAudit(requestId: string) {
    const [row] = await sql<{
      action: string;
      target_type: string;
      target_id: string | null;
      outcome: string;
      metadata: Record<string, unknown>;
    }[]>`
      select action, target_type, target_id, outcome, metadata
      from app_private.admin_audit_events
      where request_id = ${requestId}
    `;
    return row;
  }

  async function readAuditOutbox(eventId: string) {
    const [row] = await sql<{
      id: string;
      status: string;
      outcome: string;
      attempts: number;
      metadata: Record<string, unknown>;
      last_error: string | null;
      sent_at: Date | null;
      dead_lettered_at: Date | null;
    }[]>`
      select id, status, outcome, attempts, metadata, last_error, sent_at, dead_lettered_at
      from app_private.admin_audit_outbox
      where id = ${eventId}
    `;
    return row;
  }

  async function request(
    actor: Actor,
    init: RequestInit,
    options: NonNullable<Parameters<typeof createApp>[0]> = {},
  ): Promise<Response> {
    const app = createApp({
      ...options,
      env: { ...adminEnv(actor), ...(options.env ?? {}) },
      disposeDatabase: true,
    });
    return app.request("/admin/categories", {
      ...init,
      headers: {
        Cookie: `agromarket_session=${actor.token}`,
        ...(init.headers ?? {}),
      },
    });
  }

  afterAll(async () => {
    await sql.end({ timeout: 0 });
  });

  test("records a successful mutation with scalar, PII-safe metadata", async () => {
    const actor = await createActor("success");
    let categoryId: string | undefined;
    try {
      const response = await request(actor, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "product", name: `[td-003b] audit ${crypto.randomUUID()}` }),
      });
      expect(response.status).toBe(201);
      categoryId = (await response.json() as { id: string }).id;
      const requestId = response.headers.get("X-Request-ID");
      expect(requestId).toBeTruthy();
      expect(await readAudit(requestId!)).toEqual({
        action: "post:categories",
        target_type: "categories",
        target_id: null,
        outcome: "success",
        metadata: { status: 201 },
      });
    } finally {
      if (categoryId) await sql`delete from public.categories where id = ${categoryId}`;
      await cleanupActor(actor);
    }
  });

  test("records a non-admin denial without persisting request-body secrets", async () => {
    const actor = await createActor("denied");
    try {
      const response = await request(actor, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "product",
          name: `[td-003b] denied ${crypto.randomUUID()}`,
          password: "denied-request-secret",
        }),
      }, { env: { ADMIN_ALLOWLIST: String(actor.telegramId + 1) } });
      expect(response.status).toBe(403);
      const requestId = response.headers.get("X-Request-ID");
      expect(requestId).toBeTruthy();
      const audit = await readAudit(requestId!);
      expect(audit).toMatchObject({ outcome: "denied", metadata: { status: 403 } });
      expect(JSON.stringify(audit)).not.toContain("denied-request-secret");
    } finally {
      await cleanupActor(actor);
    }
  });

  test("records a handler 4xx as failed without request-body data", async () => {
    const actor = await createActor("handler 4xx");
    try {
      const response = await request(actor, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: "validation-secret" }),
      });
      expect(response.status).toBe(400);
      const requestId = response.headers.get("X-Request-ID");
      expect(requestId).toBeTruthy();
      const audit = await readAudit(requestId!);
      expect(audit).toMatchObject({ outcome: "failed", metadata: { status: 400 } });
      expect(JSON.stringify(audit)).not.toContain("validation-secret");
    } finally {
      await cleanupActor(actor);
    }
  });

  test("records an unexpected handler 5xx as failed", async () => {
    const actor = await createActor("handler 5xx");
    try {
      const response = await request(actor, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "product", name: `[td-003b] failure ${crypto.randomUUID()}` }),
      }, {
        createDatabaseInvocation: (env) => databaseFailingFor(env, "insert into categories"),
      });
      expect(response.status).toBe(500);
      const requestId = response.headers.get("X-Request-ID");
      expect(requestId).toBeTruthy();
      expect(await readAudit(requestId!)).toMatchObject({ outcome: "failed", metadata: { status: 500 } });
    } finally {
      await cleanupActor(actor);
    }
  });

  test("records a PII read without copying the returned contact data", async () => {
    const actor = await createActor("PII read", true);
    try {
      const listResponse = await createApp({ env: adminEnv(actor), disposeDatabase: true }).request("/admin/users", {
        headers: { Cookie: `agromarket_session=${actor.token}` },
      });
      expect(listResponse.status).toBe(200);
      const requestId = listResponse.headers.get("X-Request-ID");
      expect(requestId).toBeTruthy();
      const audit = await readAudit(requestId!);
      expect(audit).toMatchObject({
        action: "get:users",
        target_type: "users",
        outcome: "success",
        metadata: { status: 200 },
      });
      expect(JSON.stringify(audit)).not.toContain("PII Secret Name");
      expect(JSON.stringify(audit)).not.toContain("+77005554433");
    } finally {
      await cleanupActor(actor);
    }
  });

  test("keeps a committed mutation successful and durably retries a failed audit append", async () => {
    const actor = await createActor("audit outage");
    let categoryId: string | undefined;
    let recoveryDb: DatabaseInvocation | undefined;
    try {
      const response = await request(actor, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "product", name: `[td-003b] committed ${crypto.randomUUID()}` }),
      }, {
        createDatabaseInvocation: (env) => databaseFailingFor(env, "insert into app_private.admin_audit_events"),
      });
      expect(response.status).toBe(201);
      categoryId = (await response.json() as { id: string }).id;
      expect((await sql`select id from public.categories where id = ${categoryId}`)).toHaveLength(1);
      const requestId = response.headers.get("X-Request-ID");
      expect(requestId).toBeTruthy();
      expect(await readAudit(requestId!)).toBeUndefined();
      expect(await readAuditOutbox(requestId!)).toMatchObject({
        id: requestId,
        status: "pending",
        outcome: "success",
        attempts: 1,
        metadata: { status: 201 },
        last_error: "Error",
        sent_at: null,
      });

      await sql`
        update app_private.admin_audit_outbox
        set next_attempt_at = now()
        where id = ${requestId}
      `;
      recoveryDb = openIntegrationDatabase();
      await reconcileAdminAuditOutbox(integrationEnv, recoveryDb);
      expect(await readAudit(requestId!)).toEqual({
        action: "post:categories",
        target_type: "categories",
        target_id: null,
        outcome: "success",
        metadata: { status: 201 },
      });
      expect(await readAuditOutbox(requestId!)).toMatchObject({
        status: "sent",
        attempts: 2,
        last_error: null,
      });
    } finally {
      await recoveryDb?.dispose();
      if (categoryId) await sql`delete from public.categories where id = ${categoryId}`;
      await cleanupActor(actor);
    }
  });

  test("keeps the business commit and audit intent across a post-commit outage", async () => {
    const actor = await createActor("post-commit outage");
    const categoryName = `[td-003b] crash boundary ${crypto.randomUUID()}`;
    let categoryId: string | undefined;
    let recoveryDb: DatabaseInvocation | undefined;
    try {
      const response = await request(actor, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "product", name: categoryName }),
      }, {
        createDatabaseInvocation: databaseUnavailableAfterCommit,
      });
      expect(response.status).toBe(500);
      categoryId = (await sql<{ id: string }[]>`
        select id from public.categories where name = ${categoryName}
      `)[0]?.id;
      expect(categoryId).toBeTruthy();
      const requestId = response.headers.get("X-Request-ID");
      expect(requestId).toBeTruthy();
      expect(await readAudit(requestId!)).toBeUndefined();
      expect(await readAuditOutbox(requestId!)).toMatchObject({
        status: "pending",
        attempts: 0,
        outcome: "success",
      });

      recoveryDb = openIntegrationDatabase();
      await reconcileAdminAuditOutbox(integrationEnv, recoveryDb);
      expect(await readAudit(requestId!)).toMatchObject({ outcome: "success", metadata: { status: 201 } });
      expect(await readAuditOutbox(requestId!)).toMatchObject({ status: "sent", attempts: 1 });
    } finally {
      await recoveryDb?.dispose();
      if (categoryId) await sql`delete from public.categories where id = ${categoryId}`;
      await cleanupActor(actor);
    }
  });

  test("dead-letters poison rows and exposes explicit operator requeue", async () => {
    const actor = await createActor("audit poison");
    const requestId = crypto.randomUUID();
    const seedDb = openIntegrationDatabase();
    const failingDb = databaseFailingFor(integrationEnv, "insert into app_private.admin_audit_events");
    const recoveryDb = openIntegrationDatabase();
    try {
      await enqueueAdminAuditEvent(integrationEnv, {
        eventId: requestId,
        actor: { userId: actor.id, telegramId: actor.telegramId, isRegistered: false },
        requestId,
        action: "post:categories",
        targetType: "categories",
        outcome: "success",
        metadata: { status: 201 },
      }, seedDb);
      await sql`
        update app_private.admin_audit_outbox
        set attempts = 19, next_attempt_at = now() - interval '1 second'
        where id = ${requestId}
      `;

      await expect(processAdminAuditOutbox(integrationEnv, requestId, failingDb)).resolves.toBe(false);
      expect(await readAuditOutbox(requestId)).toMatchObject({
        status: "dead_letter",
        attempts: 20,
        last_error: "Error",
      });
      expect((await readAuditOutbox(requestId))?.dead_lettered_at).toBeInstanceOf(Date);

      await expect(requeueAdminAuditOutbox(requestId, recoveryDb)).resolves.toBe(true);
      expect(await readAuditOutbox(requestId)).toMatchObject({ status: "pending", attempts: 0, last_error: null });
      await expect(processAdminAuditOutbox(integrationEnv, requestId, recoveryDb)).resolves.toBe(true);
      expect(await readAuditOutbox(requestId)).toMatchObject({ status: "sent", attempts: 1 });
    } finally {
      await seedDb.dispose();
      await failingDb.dispose();
      await recoveryDb.dispose();
      await cleanupActor(actor);
    }
  });

  test("claims a pending audit event once under concurrent recovery", async () => {
    const actor = await createActor("audit concurrency");
    const requestId = crypto.randomUUID();
    const seedDb = openIntegrationDatabase();
    const firstDb = openIntegrationDatabase();
    const secondDb = openIntegrationDatabase();
    try {
      await enqueueAdminAuditEvent(integrationEnv, {
        eventId: requestId,
        actor: {
          userId: actor.id,
          telegramId: actor.telegramId,
          isRegistered: false,
        },
        requestId,
        action: "delete:categories/:id",
        targetType: "categories",
        targetId: crypto.randomUUID(),
        outcome: "failed",
        metadata: { status: 500 },
      }, seedDb);

      await Promise.all([
        processAdminAuditOutbox(integrationEnv, requestId, firstDb),
        processAdminAuditOutbox(integrationEnv, requestId, secondDb),
      ]);

      const [eventCount] = await sql<{ count: string }[]>`
        select count(*)::text as count
        from app_private.admin_audit_events
        where id = ${requestId}
      `;
      expect(eventCount?.count).toBe("1");
      expect(await readAudit(requestId)).toMatchObject({
        outcome: "failed",
        metadata: { status: 500 },
      });
      expect(await readAuditOutbox(requestId)).toMatchObject({
        status: "sent",
        attempts: 1,
      });
    } finally {
      await seedDb.dispose();
      await firstDb.dispose();
      await secondDb.dispose();
      await cleanupActor(actor);
    }
  });
});
