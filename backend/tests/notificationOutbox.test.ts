import { afterAll, expect, test } from "bun:test";
import type { AppEnv } from "../src/env";
import {
  processNotificationOutbox,
  reconcileNotificationOutbox,
} from "../src/lib/notificationOutbox";
import {
  describeIntegration,
  integrationEnv,
  openIntegrationDatabase,
  openIntegrationSql,
} from "./integrationTestDatabase";

interface Fixture {
  userId: string;
  feedbackId: string;
  outboxId: string;
}

describeIntegration("notification outbox durability", () => {
  const sql = openIntegrationSql();
  let telegramSequence = 0;

  function nextTelegramId(): number {
    telegramSequence += 1;
    return 8_200_000_000 + telegramSequence;
  }

  async function createFixture(label: string): Promise<Fixture> {
    const fixture = {
      userId: crypto.randomUUID(),
      feedbackId: crypto.randomUUID(),
      outboxId: crypto.randomUUID(),
    };
    await sql`
      insert into public.users (id, telegram_id, telegram_first_name)
      values (${fixture.userId}, ${nextTelegramId()}, ${`[td-003b] ${label}`})
    `;
    await sql`
      insert into public.feedback_messages (
        id, user_id, contact_name, contact_phone, contact_phone_verified, message
      )
      values (
        ${fixture.feedbackId}, ${fixture.userId}, 'Integration User', '+77001234567', false,
        ${`[td-003b] ${label} message`}
      )
    `;
    await sql`
      insert into app_private.notification_outbox (id, event_type, feedback_id)
      values (${fixture.outboxId}, 'feedback', ${fixture.feedbackId})
    `;
    return fixture;
  }

  async function cleanupFixture(fixture: Fixture): Promise<void> {
    await sql`delete from public.feedback_messages where id = ${fixture.feedbackId}`;
    await sql`delete from public.users where id = ${fixture.userId}`;
  }

  async function setAdminChatId(chatId: string | null): Promise<void> {
    await sql`
      insert into public.platform_settings (id, admin_chat_id)
      values (1, ${chatId})
      on conflict (id) do update set admin_chat_id = excluded.admin_chat_id
    `;
  }

  async function readOutbox(outboxId: string) {
    const [row] = await sql<{
      status: string;
      attempts: number;
      next_attempt_at: Date;
      processing_at: Date | null;
      last_error: string | null;
      sent_at: Date | null;
    }[]>`
      select status, attempts, next_attempt_at, processing_at, last_error, sent_at
      from app_private.notification_outbox
      where id = ${outboxId}
    `;
    return row;
  }

  async function withTelegramFetch(
    handler: (calls: { body: string; url: string }[]) => Promise<void>,
    responseFactory: (attempt: number) => Response = () => Response.json({ ok: true }),
  ): Promise<void> {
    const originalFetch = globalThis.fetch;
    const calls: { body: string; url: string }[] = [];
    globalThis.fetch = (async (input, init) => {
      calls.push({ body: String(init?.body ?? ""), url: String(input) });
      return responseFactory(calls.length);
    }) as typeof fetch;
    try {
      await handler(calls);
    } finally {
      globalThis.fetch = originalFetch;
    }
  }

  afterAll(async () => {
    await setAdminChatId(null);
    await sql.end({ timeout: 0 });
  });

  test("claims one row under concurrency and ignores a duplicate delivery receipt", async () => {
    const fixture = await createFixture("concurrent claim");
    await setAdminChatId("-100820000001");
    const firstDb = openIntegrationDatabase();
    const secondDb = openIntegrationDatabase();
    const retryDb = openIntegrationDatabase();

    try {
      await withTelegramFetch(async (calls) => {
        const results = await Promise.all([
          processNotificationOutbox(integrationEnv, fixture.outboxId, firstDb),
          processNotificationOutbox(integrationEnv, fixture.outboxId, secondDb),
        ]);
        expect(results.filter(Boolean)).toHaveLength(1);
        expect(results.filter((result) => !result)).toHaveLength(1);
        expect(calls).toHaveLength(1);
        expect(calls[0]?.body).toContain(fixture.outboxId);

        await expect(processNotificationOutbox(integrationEnv, fixture.outboxId, retryDb)).resolves.toBe(true);
      });

      expect(await readOutbox(fixture.outboxId)).toMatchObject({
        status: "sent",
        attempts: 1,
        processing_at: null,
        last_error: null,
      });
      expect((await readOutbox(fixture.outboxId))?.sent_at).toBeInstanceOf(Date);
    } finally {
      await firstDb.dispose();
      await secondDb.dispose();
      await retryDb.dispose();
      await cleanupFixture(fixture);
    }
  });

  test("reclaims a stale processing row left by a crashed worker", async () => {
    const fixture = await createFixture("stale processing recovery");
    const db = openIntegrationDatabase();

    try {
      await setAdminChatId("-100820000004");
      await sql`
        update app_private.notification_outbox
        set status = 'processing',
            processing_at = now() - interval '11 minutes',
            processing_token = ${crypto.randomUUID()},
            attempts = 1
        where id = ${fixture.outboxId}
      `;
      await withTelegramFetch(async (calls) => {
        await expect(processNotificationOutbox(integrationEnv, fixture.outboxId, db)).resolves.toBe(true);
        expect(calls).toHaveLength(1);
      });
      expect(await readOutbox(fixture.outboxId)).toMatchObject({
        status: "sent",
        attempts: 2,
        processing_at: null,
      });
    } finally {
      await db.dispose();
      await cleanupFixture(fixture);
    }
  });

  test("does not acknowledge a fresh lease or perform a duplicate send", async () => {
    const fixture = await createFixture("fresh lease");
    const db = openIntegrationDatabase();

    try {
      await setAdminChatId("-100820000005");
      await sql`
        update app_private.notification_outbox
        set status = 'processing',
            processing_at = now(),
            processing_token = ${crypto.randomUUID()},
            attempts = 1
        where id = ${fixture.outboxId}
      `;
      await withTelegramFetch(async (calls) => {
        await expect(processNotificationOutbox(integrationEnv, fixture.outboxId, db)).resolves.toBe(false);
        expect(calls).toHaveLength(0);
      });
      expect(await readOutbox(fixture.outboxId)).toMatchObject({ status: "processing", attempts: 1 });
    } finally {
      await db.dispose();
      await cleanupFixture(fixture);
    }
  });

  test("fences an old worker after a stale lease is reclaimed", async () => {
    const fixture = await createFixture("lease fencing");
    const firstDb = openIntegrationDatabase();
    const secondDb = openIntegrationDatabase();
    const originalFetch = globalThis.fetch;
    let calls = 0;
    let firstFetchStarted!: () => void;
    let releaseFirstFetch!: () => void;
    const fetchStarted = new Promise<void>((resolve) => { firstFetchStarted = resolve; });
    const firstRelease = new Promise<void>((resolve) => { releaseFirstFetch = resolve; });
    globalThis.fetch = (async () => {
      calls += 1;
      if (calls === 1) {
        firstFetchStarted();
        await firstRelease;
      }
      return Response.json({ ok: true });
    }) as typeof fetch;

    try {
      await setAdminChatId("-100820000006");
      const first = processNotificationOutbox(integrationEnv, fixture.outboxId, firstDb);
      await fetchStarted;
      await sql`
        update app_private.notification_outbox
        set processing_at = now() - interval '11 minutes'
        where id = ${fixture.outboxId}
      `;
      const second = processNotificationOutbox(integrationEnv, fixture.outboxId, secondDb);
      await expect(second).resolves.toBe(true);
      releaseFirstFetch();
      await expect(first).resolves.toBe(false);
      expect(calls).toBe(2);
      expect(await readOutbox(fixture.outboxId)).toMatchObject({ status: "sent", attempts: 2 });
    } finally {
      globalThis.fetch = originalFetch;
      await firstDb.dispose();
      await secondDb.dispose();
      await cleanupFixture(fixture);
    }
  });

  test("keeps a failed delivery pending until next_attempt_at, then sends it", async () => {
    const fixture = await createFixture("retry state");
    const firstDb = openIntegrationDatabase();
    const secondDb = openIntegrationDatabase();

    try {
      await setAdminChatId(null);
      await expect(processNotificationOutbox(integrationEnv, fixture.outboxId, firstDb)).resolves.toBe(false);
      const failed = await readOutbox(fixture.outboxId);
      expect(failed).toMatchObject({
        status: "pending",
        attempts: 1,
        processing_at: null,
        last_error: "admin_chat_id is not configured",
      });
      expect(failed?.next_attempt_at.getTime()).toBeGreaterThan(Date.now());

      await expect(processNotificationOutbox(integrationEnv, fixture.outboxId, secondDb)).resolves.toBe(false);
      expect((await readOutbox(fixture.outboxId))?.attempts).toBe(1);

      await sql`
        update app_private.notification_outbox
        set next_attempt_at = now()
        where id = ${fixture.outboxId}
      `;
      await setAdminChatId("-100820000002");
      await withTelegramFetch(async (calls) => {
        await expect(processNotificationOutbox(integrationEnv, fixture.outboxId, secondDb)).resolves.toBe(true);
        expect(calls).toHaveLength(1);
      });
      expect(await readOutbox(fixture.outboxId)).toMatchObject({ status: "sent", attempts: 2 });
    } finally {
      await firstDb.dispose();
      await secondDb.dispose();
      await cleanupFixture(fixture);
    }
  });

  test("records a Telegram rejection as retryable outbox failure", async () => {
    const fixture = await createFixture("telegram rejection");
    const db = openIntegrationDatabase();

    try {
      await setAdminChatId("-100820000003");
      await withTelegramFetch(async (calls) => {
        await expect(processNotificationOutbox(integrationEnv, fixture.outboxId, db)).resolves.toBe(false);
        expect(calls).toHaveLength(2);
      }, () => new Response("rejected", { status: 503 }));
      const failed = await readOutbox(fixture.outboxId);
      expect(failed).toMatchObject({
        status: "pending",
        attempts: 1,
        processing_at: null,
        last_error: "Telegram Bot API rejected the message",
      });
      expect(failed?.next_attempt_at.getTime()).toBeGreaterThan(Date.now());
    } finally {
      await db.dispose();
      await cleanupFixture(fixture);
    }
  });

  test("moves the twentieth failed attempt to the terminal dead-letter state", async () => {
    const fixture = await createFixture("terminal state");
    const db = openIntegrationDatabase();

    try {
      await setAdminChatId(null);
      await sql`
        update app_private.notification_outbox
        set attempts = 19, next_attempt_at = now() - interval '1 second'
        where id = ${fixture.outboxId}
      `;
      await expect(processNotificationOutbox(integrationEnv, fixture.outboxId, db)).resolves.toBe(false);
      expect(await readOutbox(fixture.outboxId)).toMatchObject({
        status: "dead_letter",
        attempts: 20,
        processing_at: null,
        last_error: "admin_chat_id is not configured",
      });

      await expect(processNotificationOutbox(integrationEnv, fixture.outboxId, db)).resolves.toBe(true);
      expect((await readOutbox(fixture.outboxId))?.attempts).toBe(20);
    } finally {
      await db.dispose();
      await cleanupFixture(fixture);
    }
  });

  test("reconciles a pending row when the queue enqueue acknowledgement was lost", async () => {
    const fixture = await createFixture("reconciliation");
    const messages: { outboxId: string }[] = [];
    const queueEnv: AppEnv = {
      ...integrationEnv,
      NOTIFICATION_QUEUE: {
        send: async (message) => {
          messages.push(message);
        },
      },
    };
    const db = openIntegrationDatabase(queueEnv);

    try {
      await sql`
        update app_private.notification_outbox
        set next_attempt_at = now() - interval '1 second'
        where id = ${fixture.outboxId}
      `;
      await reconcileNotificationOutbox(queueEnv, db);
      expect(messages).toEqual([{ outboxId: fixture.outboxId }]);
      expect(await readOutbox(fixture.outboxId)).toMatchObject({ status: "pending", attempts: 0 });
    } finally {
      await db.dispose();
      await cleanupFixture(fixture);
    }
  });

  test("reconciliation is bounded to the database query batch size", async () => {
    const fixtures = await Promise.all(
      Array.from({ length: 51 }, (_, index) => createFixture(`bounded ${index}`)),
    );
    const messages: { outboxId: string }[] = [];
    const queueEnv: AppEnv = {
      ...integrationEnv,
      NOTIFICATION_QUEUE: {
        send: async (message) => {
          messages.push(message);
        },
      },
    };
    const db = openIntegrationDatabase(queueEnv);

    try {
      await sql`
        update app_private.notification_outbox
        set next_attempt_at = now() - interval '1 second'
        where id = any(${sql.array(fixtures.map((fixture) => fixture.outboxId))})
      `;
      await reconcileNotificationOutbox(queueEnv, db);
      expect(messages).toHaveLength(50);
      expect(new Set(messages.map((message) => message.outboxId)).size).toBe(50);
    } finally {
      await db.dispose();
      for (const fixture of fixtures) await cleanupFixture(fixture);
    }
  });
});
