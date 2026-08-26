import { afterAll, expect, test } from "bun:test";
import postgres from "postgres";
import { processAdminAuditOutbox } from "../src/lib/adminAuditOutbox";
import { appendAdminAuditEvent, enqueueAdminAuditEvent } from "../src/repos/adminAudit";
import { deleteAccount, runPrivacyRetention } from "../src/repos/privacy";
import {
  describeIntegration,
  integrationEnv,
  openIntegrationDatabase,
  openIntegrationSql,
} from "./integrationTestDatabase";

interface UserFixture {
  id: string;
  telegramId: number;
}

describeIntegration("privacy retention and legal holds", () => {
  const sql = openIntegrationSql();
  let telegramSequence = 0;

  function nextTelegramId(): number {
    telegramSequence += 1;
    return 8_300_000_000 + telegramSequence;
  }

  async function createUser(
    label: string,
    options: {
      registered?: boolean;
      createdAt?: string;
      lastSeenAt?: string;
      contact?: boolean;
    } = {},
  ): Promise<UserFixture> {
    const fixture = { id: crypto.randomUUID(), telegramId: nextTelegramId() };
    const registered = options.registered ?? false;
    const contact = options.contact ?? registered;
    await sql`
      insert into public.users (
        id, telegram_id, telegram_first_name, contact_name, contact_phone,
        registered_at, created_at, last_seen_at
      )
      values (
        ${fixture.id}, ${fixture.telegramId}, ${`[td-003b] ${label}`},
        ${contact ? `Contact ${label}` : null}, ${contact ? "+77001234567" : null},
        ${registered ? new Date().toISOString() : null},
        ${options.createdAt ?? new Date().toISOString()},
        ${options.lastSeenAt ?? new Date().toISOString()}
      )
    `;
    return fixture;
  }

  async function cleanupUser(fixture: UserFixture): Promise<void> {
    await sql`delete from app_private.admin_audit_events where actor_user_id = ${fixture.id}`;
    await sql`delete from public.users where id = ${fixture.id}`;
  }

  function oldDate(days: number): string {
    return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  }

  afterAll(async () => {
    await sql.end({ timeout: 0 });
  });

  test("blocks account deletion under a legal hold and serializes a concurrent hold", async () => {
    const fixture = await createUser("legal hold", { registered: true });
    const deletionDb = openIntegrationDatabase();
    const holdSql = postgres(integrationEnv.DATABASE_URL!, { prepare: false, max: 1 });
    let releaseHold!: () => void;
    let holdInserted!: () => void;
    const release = new Promise<void>((resolve) => { releaseHold = resolve; });
    const inserted = new Promise<void>((resolve) => { holdInserted = resolve; });
    const holder = holdSql.begin(async (tx) => {
      await tx`
        insert into app_private.privacy_holds (user_id, reason)
        values (${fixture.id}, 'integration legal hold')
      `;
      holdInserted();
      await release;
    });

    try {
      await holdInserted;
      const deletion = deleteAccount(integrationEnv, fixture.id, deletionDb);
      await new Promise((resolve) => setTimeout(resolve, 50));
      releaseHold();
      await expect(deletion).rejects.toMatchObject({ status: 409 });
      await holder;

      const [user] = await sql<{ deleted_at: Date | null; telegram_id: string }[]>`
        select deleted_at, telegram_id from public.users where id = ${fixture.id}
      `;
      expect(user?.deleted_at).toBeNull();
      expect(Number(user?.telegram_id)).toBe(fixture.telegramId);
    } finally {
      releaseHold();
      await holder.catch(() => {});
      await deletionDb.dispose();
      await holdSql.end({ timeout: 0 });
      await sql`delete from app_private.privacy_holds where user_id = ${fixture.id}`;
      await cleanupUser(fixture);
    }
  });

  test("applies strict retention boundaries and preserves held PII", async () => {
    const boundary = await createUser("retention boundary", {
      createdAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000 + 60_000).toISOString(),
    });
    const expired = await createUser("retention expired", {
      createdAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000 - 60_000).toISOString(),
    });
    const retained = await createUser("request retained", { registered: true, contact: true });
    const held = await createUser("held request", { registered: true, contact: true });
    const requestId = crypto.randomUUID();
    const heldRequestId = crypto.randomUUID();
    const feedbackId = crypto.randomUUID();
    const heldFeedbackId = crypto.randomUUID();

    await sql`
      insert into public.requests (
        id, user_id, source, contact_name, contact_phone, comment, status, created_at, updated_at
      )
      values (
        ${requestId}, ${retained.id}, 'profile', 'Old Request Name', '+77001112233',
        'Old Request Secret', 'closed', ${oldDate(181)}, ${oldDate(181)}
      ), (
        ${heldRequestId}, ${held.id}, 'profile', 'Held Request Name', '+77004445566',
        'Held Request Secret', 'closed', ${oldDate(181)}, ${oldDate(181)}
      )
    `;
    await sql`
      insert into public.feedback_messages (
        id, user_id, contact_name, contact_phone, contact_phone_verified, message, created_at
      )
      values
        (${feedbackId}, ${retained.id}, 'Old Feedback Name', '+77007778899', false, 'Old Feedback Secret', ${oldDate(181)}),
        (${heldFeedbackId}, ${held.id}, 'Held Feedback Name', '+77009990011', false, 'Held Feedback Secret', ${oldDate(181)})
    `;
    await sql`
      insert into app_private.privacy_holds (user_id, reason)
      values (${held.id}, 'legal retention')
    `;
    const db = openIntegrationDatabase();

    try {
      await runPrivacyRetention(integrationEnv, db);

      expect((await sql`select id from public.users where id = ${boundary.id}`)).toHaveLength(1);
      expect((await sql`select id from public.users where id = ${expired.id}`)).toHaveLength(0);

      const [request] = await sql<{ contact_name: string; contact_phone: string; comment: string }[]>`
        select contact_name, contact_phone, comment from public.requests where id = ${requestId}
      `;
      expect(request).toEqual({
        contact_name: "[удалено]",
        contact_phone: "[удалено]",
        comment: "[удалено]",
      });
      const [feedback] = await sql<{ contact_name: string; contact_phone: string; message: string }[]>`
        select contact_name, contact_phone, message from public.feedback_messages where id = ${feedbackId}
      `;
      expect(feedback).toEqual({
        contact_name: "[удалено]",
        contact_phone: "[удалено]",
        message: "[удалено]",
      });

      const [heldRequest] = await sql<{ contact_name: string; contact_phone: string; comment: string }[]>`
        select contact_name, contact_phone, comment from public.requests where id = ${heldRequestId}
      `;
      expect(heldRequest).toEqual({
        contact_name: "Held Request Name",
        contact_phone: "+77004445566",
        comment: "Held Request Secret",
      });
      const [heldFeedback] = await sql<{ contact_name: string; contact_phone: string; message: string }[]>`
        select contact_name, contact_phone, message from public.feedback_messages where id = ${heldFeedbackId}
      `;
      expect(heldFeedback).toEqual({
        contact_name: "Held Feedback Name",
        contact_phone: "+77009990011",
        message: "Held Feedback Secret",
      });
    } finally {
      await db.dispose();
      await sql`delete from app_private.privacy_holds where user_id = ${held.id}`;
      await sql`delete from public.feedback_messages where id in (${feedbackId}, ${heldFeedbackId})`;
      await sql`delete from public.requests where id in (${requestId}, ${heldRequestId})`;
      await cleanupUser(boundary);
      await cleanupUser(expired);
      await cleanupUser(retained);
      await cleanupUser(held);
    }
  });

  test("processes at most 100 inactive accounts and resumes the remaining batch", async () => {
    const fixtures = await Promise.all(
      Array.from({ length: 105 }, (_, index) => createUser(`bounded ${index}`, {
        registered: true,
        createdAt: oldDate(900),
        lastSeenAt: oldDate(900),
      })),
    );
    const db = openIntegrationDatabase();

    try {
      await runPrivacyRetention(integrationEnv, db);
      const [firstPass] = await sql<{ live: string; deleted: string }[]>`
        select
          count(*) filter (where deleted_at is null)::text as live,
          count(*) filter (where deleted_at is not null)::text as deleted
        from public.users
        where id = any(${sql.array(fixtures.map((fixture) => fixture.id))})
      `;
      expect(firstPass).toEqual({ live: "5", deleted: "100" });

      await runPrivacyRetention(integrationEnv, db);
      const [secondPass] = await sql<{ live: string; deleted: string }[]>`
        select
          count(*) filter (where deleted_at is null)::text as live,
          count(*) filter (where deleted_at is not null)::text as deleted
        from public.users
        where id = any(${sql.array(fixtures.map((fixture) => fixture.id))})
      `;
      expect(secondPass).toEqual({ live: "0", deleted: "105" });
    } finally {
      await db.dispose();
      for (const fixture of fixtures) await cleanupUser(fixture);
    }
  });

  test("resumes after a concurrent hold causes one account deletion to fail", async () => {
    const fixture = await createUser("resume after failure", {
      registered: true,
      createdAt: oldDate(900),
      lastSeenAt: oldDate(900),
    });
    const holdSql = postgres(integrationEnv.DATABASE_URL!, { prepare: false, max: 1 });
    const db = openIntegrationDatabase();
    let releaseHold!: () => void;
    let holdInserted!: () => void;
    const release = new Promise<void>((resolve) => { releaseHold = resolve; });
    const inserted = new Promise<void>((resolve) => { holdInserted = resolve; });
    const holder = holdSql.begin(async (tx) => {
      await tx`
        insert into app_private.privacy_holds (user_id, reason)
        values (${fixture.id}, 'resume failure')
      `;
      holdInserted();
      await release;
    });

    try {
      await holdInserted;
      const retention = runPrivacyRetention(integrationEnv, db);
      await new Promise((resolve) => setTimeout(resolve, 50));
      releaseHold();
      await expect(retention).rejects.toMatchObject({ status: 409 });
      await holder;

      expect((await sql`select deleted_at from public.users where id = ${fixture.id}`)[0]?.deleted_at).toBeNull();
      await sql`delete from app_private.privacy_holds where user_id = ${fixture.id}`;
      await runPrivacyRetention(integrationEnv, db);
      expect((await sql`select deleted_at from public.users where id = ${fixture.id}`)[0]?.deleted_at).toBeInstanceOf(Date);
    } finally {
      releaseHold();
      await holder.catch(() => {});
      await db.dispose();
      await holdSql.end({ timeout: 0 });
      await sql`delete from app_private.privacy_holds where user_id = ${fixture.id}`;
      await cleanupUser(fixture);
    }
  });

  test("physically deletes an audit-referenced user while preserving anonymised audit history", async () => {
    const fixture = await createUser("audit retention", {
      createdAt: oldDate(45),
      lastSeenAt: oldDate(45),
    });
    const eventId = crypto.randomUUID();
    const auditDb = openIntegrationDatabase();
    const retentionDb = openIntegrationDatabase();
    const recoveryDb = openIntegrationDatabase();
    const auditInput = {
      eventId,
      actor: { userId: fixture.id, telegramId: fixture.telegramId, isRegistered: false },
      requestId: eventId,
      action: "post:categories",
      targetType: "categories",
      outcome: "success" as const,
      metadata: { status: 201 },
    };

    try {
      await enqueueAdminAuditEvent(integrationEnv, auditInput, auditDb);
      await appendAdminAuditEvent(integrationEnv, auditInput, auditDb);
      await runPrivacyRetention(integrationEnv, retentionDb);

      expect((await sql`select id from public.users where id = ${fixture.id}`)).toHaveLength(0);
      const [history] = await sql<{
        actor_user_id: string | null;
        actor_telegram_id: string;
        metadata: Record<string, unknown>;
      }[]>`
        select actor_user_id, actor_telegram_id, metadata
        from app_private.admin_audit_events
        where id = ${eventId}
      `;
      expect(history).toEqual({
        actor_user_id: null,
        actor_telegram_id: String(fixture.telegramId),
        metadata: { status: 201 },
      });

      const [pending] = await sql<{ actor_user_id: string | null; status: string }[]>`
        select actor_user_id, status
        from app_private.admin_audit_outbox
        where id = ${eventId}
      `;
      expect(pending).toEqual({ actor_user_id: null, status: "pending" });

      await expect(processAdminAuditOutbox(integrationEnv, eventId, recoveryDb)).resolves.toBe(true);
      expect((await sql<{ status: string; actor_user_id: string | null }[]>`
        select status, actor_user_id
        from app_private.admin_audit_outbox
        where id = ${eventId}
      `)[0]).toEqual({ status: "sent", actor_user_id: null });
    } finally {
      await auditDb.dispose();
      await retentionDb.dispose();
      await recoveryDb.dispose();
      await sql`delete from app_private.admin_audit_outbox where id = ${eventId}`;
      await sql`delete from app_private.admin_audit_events where id = ${eventId}`;
      await cleanupUser(fixture);
    }
  });
});
