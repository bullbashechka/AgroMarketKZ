import { afterAll, describe, expect, test } from "bun:test";
import postgres from "postgres";
import type { AppEnv } from "../src/env";
import { createDatabaseInvocation } from "../src/db";
import {
  hashSessionToken,
  SESSION_GRACE_SECONDS,
  SESSION_ROTATION_SECONDS,
} from "../src/lib/session";
import { telegramIdentityHash } from "../src/lib/telegram";
import { deleteAccount } from "../src/repos/privacy";
import {
  exchangeTelegramSession,
  exchangeWidgetTelegramSession,
  findSessionAuthUser,
  revokeAllUserSessions,
  revokeSession,
} from "../src/repos/sessions";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeIntegration = databaseUrl ? describe : describe.skip;

const env: AppEnv = {
  WEBAPP_ORIGIN: "http://127.0.0.1:5173",
  TELEGRAM_BOT_TOKEN: "integration-only-bot-token",
  ADMIN_ALLOWLIST: "",
  DATABASE_URL: databaseUrl ?? "postgresql://127.0.0.1:1/disabled",
  SUPABASE_URL: "https://integration-only.invalid",
  SUPABASE_STORAGE_BUCKET: "card-images",
  SUPABASE_SERVICE_ROLE_KEY: "integration-only-service-role-key",
};

const sql = postgres(env.DATABASE_URL, { prepare: false, max: 1 });
let telegramSequence = 0;

function nextTelegramId(): number {
  telegramSequence += 1;
  return 8_100_000_000 + telegramSequence;
}

function currentUnixSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

async function waitForDatabaseEpoch(epoch: number): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const [clock] = await sql<{ db_now: string }[]>`
      select floor(extract(epoch from clock_timestamp()))::bigint as db_now
    `;
    if (Number(clock?.db_now) >= epoch) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Database clock did not reach ${epoch}`);
}

async function exchange(telegramId: number, authDate = currentUnixSeconds() - 10) {
  const db = createDatabaseInvocation(env);
  try {
    return await exchangeTelegramSession(env, {
      id: telegramId,
      username: "integration-user",
      firstName: "Integration",
      lastName: "User",
    }, authDate, db);
  } finally {
    await db.dispose();
  }
}

async function exchangeWidget(telegramId: number, proofHash: string, authDate = currentUnixSeconds() - 10) {
  const db = createDatabaseInvocation(env);
  try {
    return await exchangeWidgetTelegramSession(env, {
      id: telegramId,
      username: "integration-user",
      firstName: "Integration",
      lastName: "User",
    }, proofHash, authDate, db);
  } finally {
    await db.dispose();
  }
}

async function cleanupUser(userId: string, telegramId: number): Promise<void> {
  const identityHash = await telegramIdentityHash(telegramId, env.TELEGRAM_BOT_TOKEN);
  await sql`delete from app_private.telegram_auth_cutoffs where identity_hash = ${identityHash}`;
  await sql`delete from public.users where id = ${userId}`;
}

describeIntegration("session persistence and credential revocation", () => {
  afterAll(async () => {
    await sql.end({ timeout: 0 });
  });

  test("full revocation rejects the old proof and accepts a newer launch", async () => {
    const telegramId = nextTelegramId();
    const authDate = currentUnixSeconds() - 10;
    const initial = await exchange(telegramId, authDate);
    const revokeDb = createDatabaseInvocation(env);

    try {
      expect(await revokeAllUserSessions(env, initial.row.id, revokeDb)).toBe(true);
      await expect(exchange(telegramId, authDate)).rejects.toMatchObject({ status: 401 });

      const identityHash = await telegramIdentityHash(telegramId, env.TELEGRAM_BOT_TOKEN);
      const [cutoff] = await sql<{ auth_not_before: string }[]>`
        select auth_not_before
        from app_private.telegram_auth_cutoffs
        where identity_hash = ${identityHash}
      `;
      expect(cutoff).toBeTruthy();
      await expect(exchange(telegramId, Number(cutoff!.auth_not_before))).rejects.toMatchObject({ status: 401 });

      await waitForDatabaseEpoch(Number(cutoff!.auth_not_before) + 1);
      const fresh = await exchange(telegramId, Number(cutoff!.auth_not_before) + 1);
      expect(fresh.row.id).toBe(initial.row.id);
    } finally {
      await revokeDb.dispose();
      await cleanupUser(initial.row.id, telegramId);
    }
  });

  test("account deletion cuts off the old proof before anonymising the user", async () => {
    const telegramId = nextTelegramId();
    const authDate = currentUnixSeconds() - 10;
    const initial = await exchange(telegramId, authDate);
    const deletionDb = createDatabaseInvocation(env);

    try {
      await deleteAccount(env, initial.row.id, deletionDb);
      await expect(exchange(telegramId, authDate)).rejects.toMatchObject({ status: 401 });

      const identityHash = await telegramIdentityHash(telegramId, env.TELEGRAM_BOT_TOKEN);
      const [cutoff] = await sql<{ auth_not_before: string }[]>`
        select auth_not_before
        from app_private.telegram_auth_cutoffs
        where identity_hash = ${identityHash}
      `;
      expect(cutoff).toBeTruthy();
      await expect(exchange(telegramId, Number(cutoff!.auth_not_before))).rejects.toMatchObject({ status: 401 });

      await waitForDatabaseEpoch(Number(cutoff!.auth_not_before) + 1);
      const fresh = await exchange(telegramId, Number(cutoff!.auth_not_before) + 1);
      expect(fresh.row.id).not.toBe(initial.row.id);

      const [deleted] = await sql<{ telegram_id: string; deleted_at: Date | null }[]>`
        select telegram_id, deleted_at from public.users where id = ${initial.row.id}
      `;
      expect(Number(deleted?.telegram_id)).toBe(-telegramId);
      expect(deleted?.deleted_at).toBeInstanceOf(Date);
      await expect(sql`
        insert into app_private.privacy_holds (user_id, reason)
        values (${initial.row.id}, 'post-delete hold')
      `).rejects.toThrow("privacy hold requires a live user");

      await cleanupUser(fresh.row.id, telegramId);
    } finally {
      await deletionDb.dispose();
      await cleanupUser(initial.row.id, telegramId);
    }
  });

  test("Login Widget proof exchange shares the cutoff and one-use boundary", async () => {
    const telegramId = nextTelegramId();
    const authDate = currentUnixSeconds() - 10;
    const initial = await exchangeWidget(telegramId, "widget-proof-1", authDate);
    const revokeDb = createDatabaseInvocation(env);

    try {
      await expect(exchangeWidget(telegramId, "widget-proof-1", authDate)).rejects.toMatchObject({ status: 401 });
      expect(await revokeAllUserSessions(env, initial.row.id, revokeDb)).toBe(true);
      await expect(exchangeWidget(telegramId, "widget-proof-2", authDate)).rejects.toMatchObject({ status: 401 });

      const identityHash = await telegramIdentityHash(telegramId, env.TELEGRAM_BOT_TOKEN);
      const [cutoff] = await sql<{ auth_not_before: string }[]>`
        select auth_not_before
        from app_private.telegram_auth_cutoffs
        where identity_hash = ${identityHash}
      `;
      expect(cutoff).toBeTruthy();
      await waitForDatabaseEpoch(Number(cutoff!.auth_not_before) + 1);
      const fresh = await exchangeWidget(telegramId, "widget-proof-3", Number(cutoff!.auth_not_before) + 1);
      expect(fresh.row.id).toBe(initial.row.id);
    } finally {
      await revokeDb.dispose();
      await cleanupUser(initial.row.id, telegramId);
    }
  });

  test("account deletion loses no legal hold inserted during its parent-row lock", async () => {
    const telegramId = nextTelegramId();
    const initial = await exchange(telegramId);
    const holdSql = postgres(env.DATABASE_URL, { prepare: false, max: 1 });
    const deletionDb = createDatabaseInvocation(env);
    let releaseHold!: () => void;
    let notifyInserted!: () => void;
    const holdRelease = new Promise<void>((resolve) => { releaseHold = resolve; });
    const holdInserted = new Promise<void>((resolve) => { notifyInserted = resolve; });

    const holder = holdSql.begin(async (tx) => {
      await tx`
        insert into app_private.privacy_holds (user_id, reason)
        values (${initial.row.id}, 'integration race')
      `;
      notifyInserted();
      await holdRelease;
    });

    try {
      await holdInserted;
      const deletion = deleteAccount(env, initial.row.id, deletionDb);
      await new Promise((resolve) => setTimeout(resolve, 50));
      releaseHold();
      await expect(deletion).rejects.toMatchObject({ status: 409 });
      await holder;
    } finally {
      releaseHold();
      await holder.catch(() => {});
      await deletionDb.dispose();
      await holdSql.end({ timeout: 0 });
      await sql`delete from app_private.privacy_holds where user_id = ${initial.row.id}`;
      await cleanupUser(initial.row.id, telegramId);
    }
  });

  test("session lookup enforces TTL, rotation threshold, and grace expiry", async () => {
    const telegramId = nextTelegramId();
    const expired = await exchange(telegramId);
    const expiredHash = await hashSessionToken(expired.token);
    await sql`
      update app_private.user_sessions
      set expires_at = clock_timestamp() - interval '1 second'
      where token_hash = ${expiredHash}
    `;
    const db = createDatabaseInvocation(env);

    try {
      expect(await findSessionAuthUser(env, expired.token, db)).toBeUndefined();

      const current = await exchange(telegramId);
      const currentHash = await hashSessionToken(current.token);
      const [source] = await sql<{ id: string }[]>`
        select id from app_private.user_sessions where token_hash = ${currentHash}
      `;
      expect(source).toBeTruthy();

      await sql`
        update app_private.user_sessions
        set created_at = clock_timestamp()
          - (${SESSION_ROTATION_SECONDS} * interval '1 second')
          + interval '1 second'
        where id = ${source!.id}
      `;
      expect((await findSessionAuthUser(env, current.token, db))?.rotatedToken).toBeUndefined();

      await sql`
        update app_private.user_sessions
        set created_at = clock_timestamp() - (${SESSION_ROTATION_SECONDS} * interval '1 second')
        where id = ${source!.id}
      `;
      const rotated = await findSessionAuthUser(env, current.token, db);
      expect(rotated?.rotatedToken).toBeTruthy();

      await sql`
        update app_private.user_sessions
        set grace_expires_at = clock_timestamp()
          - (${SESSION_GRACE_SECONDS} * interval '1 second')
          - interval '1 second'
        where id = ${source!.id}
      `;
      expect(await findSessionAuthUser(env, current.token, db)).toBeUndefined();

      const [ttl] = await sql<{ expires_at: Date; created_at: Date }[]>`
        select expires_at, created_at
        from app_private.user_sessions
        where token_hash = ${currentHash}
      `;
      expect(ttl?.expires_at.getTime()).toBeGreaterThan(ttl?.created_at.getTime() ?? 0);
    } finally {
      await db.dispose();
      await cleanupUser(expired.row.id, telegramId);
    }
  });

  test("single logout revokes the presented token and its linked replacement", async () => {
    const telegramId = nextTelegramId();
    const initial = await exchange(telegramId);
    const sourceHash = await hashSessionToken(initial.token);
    const [source] = await sql<{ id: string }[]>`
      select id from app_private.user_sessions where token_hash = ${sourceHash}
    `;
    await sql`
      update app_private.user_sessions
      set created_at = clock_timestamp() - interval '13 hours'
      where id = ${source!.id}
    `;
    const rotationDb = createDatabaseInvocation(env);
    const logoutDb = createDatabaseInvocation(env);

    try {
      const rotated = await findSessionAuthUser(env, initial.token, rotationDb);
      expect(rotated?.rotatedToken).toBeTruthy();
      await revokeSession(env, rotated!.rotatedToken!, logoutDb);

      const [active] = await sql<{ count: string }[]>`
        select count(*)::text as count
        from app_private.user_sessions
        where user_id = ${initial.row.id} and revoked_at is null
      `;
      expect(Number(active?.count)).toBe(0);
      expect(await findSessionAuthUser(env, initial.token, rotationDb)).toBeUndefined();
      expect(await findSessionAuthUser(env, rotated!.rotatedToken!, rotationDb)).toBeUndefined();
    } finally {
      await rotationDb.dispose();
      await logoutDb.dispose();
      await cleanupUser(initial.row.id, telegramId);
    }
  });

  test("concurrent rotation creates one linked replacement and no orphan", async () => {
    const telegramId = nextTelegramId();
    const initial = await exchange(telegramId);
    const sourceHash = await hashSessionToken(initial.token);
    const [source] = await sql<{ id: string }[]>`
      select id from app_private.user_sessions where token_hash = ${sourceHash}
    `;
    await sql`
      update app_private.user_sessions
      set created_at = clock_timestamp() - interval '13 hours'
      where id = ${source!.id}
    `;

    const firstDb = createDatabaseInvocation(env);
    const secondDb = createDatabaseInvocation(env);
    try {
      const [first, second] = await Promise.all([
        findSessionAuthUser(env, initial.token, firstDb),
        findSessionAuthUser(env, initial.token, secondDb),
      ]);
      const rotatedTokens = [first, second]
        .map((result) => result?.rotatedToken)
        .filter((token): token is string => Boolean(token));
      expect(rotatedTokens.length).toBeGreaterThanOrEqual(1);
      expect(rotatedTokens.length).toBeLessThanOrEqual(2);
      expect(new Set(rotatedTokens).size).toBe(1);

      const recoveryDb = createDatabaseInvocation(env);
      try {
        const recovered = await findSessionAuthUser(env, initial.token, recoveryDb);
        expect(recovered?.rotatedToken).toBe(rotatedTokens[0]);
      } finally {
        await recoveryDb.dispose();
      }

      const rows = await sql<{
        id: string;
        replacement_session_id: string | null;
        revoked_at: Date | null;
      }[]>`
        select id, replacement_session_id, revoked_at
        from app_private.user_sessions
        where user_id = ${initial.row.id}
        order by created_at
      `;
      expect(rows).toHaveLength(2);
      const sourceRow = rows.find((row) => row.id === source!.id);
      expect(sourceRow?.replacement_session_id).toBeTruthy();
      expect(rows.filter((row) => row.replacement_session_id === null)).toHaveLength(1);
      expect(rows.filter((row) => row.revoked_at === null)).toHaveLength(2);

      const [orphans] = await sql<{ count: string }[]>`
        select count(*)::text as count
        from app_private.user_sessions child
        where child.user_id = ${initial.row.id}
          and child.id <> ${source!.id}
          and not exists (
            select 1
            from app_private.user_sessions parent
            where parent.replacement_session_id = child.id
          )
      `;
      expect(Number(orphans?.count)).toBe(0);
    } finally {
      await firstDb.dispose();
      await secondDb.dispose();
      await cleanupUser(initial.row.id, telegramId);
    }
  });

  test("rotation and full revoke leave no active replacement", async () => {
    const telegramId = nextTelegramId();
    const initial = await exchange(telegramId);
    const sourceHash = await hashSessionToken(initial.token);
    const [source] = await sql<{ id: string }[]>`
      select id from app_private.user_sessions where token_hash = ${sourceHash}
    `;
    await sql`
      update app_private.user_sessions
      set created_at = clock_timestamp() - interval '13 hours'
      where id = ${source!.id}
    `;

    const rotationDb = createDatabaseInvocation(env);
    const revokeDb = createDatabaseInvocation(env);
    try {
      await Promise.all([
        findSessionAuthUser(env, initial.token, rotationDb),
        revokeAllUserSessions(env, initial.row.id, revokeDb),
      ]);

      const [active] = await sql<{ count: string }[]>`
        select count(*)::text as count
        from app_private.user_sessions
        where user_id = ${initial.row.id} and revoked_at is null
      `;
      expect(Number(active?.count)).toBe(0);
    } finally {
      await rotationDb.dispose();
      await revokeDb.dispose();
      await cleanupUser(initial.row.id, telegramId);
    }
  });

  test("authenticated reads touch session and user activity at most once per hour", async () => {
    const telegramId = nextTelegramId();
    const initial = await exchange(telegramId);
    const tokenHash = await hashSessionToken(initial.token);

    try {
      await sql`
        update app_private.user_sessions
        set last_seen_at = clock_timestamp() - interval '30 minutes'
        where token_hash = ${tokenHash}
      `;
      await sql`
        update public.users
        set last_seen_at = clock_timestamp() - interval '30 minutes'
        where id = ${initial.row.id}
      `;
      const [before] = await sql<{ last_seen_at: Date }[]>`
        select last_seen_at from app_private.user_sessions where token_hash = ${tokenHash}
      `;
      const [userBefore] = await sql<{ last_seen_at: Date }[]>`
        select last_seen_at from public.users where id = ${initial.row.id}
      `;
      const db = createDatabaseInvocation(env);
      try {
        await findSessionAuthUser(env, initial.token, db);
        await findSessionAuthUser(env, initial.token, db);
      } finally {
        await db.dispose();
      }
      const [withinCadence] = await sql<{ last_seen_at: Date }[]>`
        select last_seen_at from app_private.user_sessions where token_hash = ${tokenHash}
      `;
      const [userWithinCadence] = await sql<{ last_seen_at: Date }[]>`
        select last_seen_at from public.users where id = ${initial.row.id}
      `;
      expect(withinCadence?.last_seen_at.getTime()).toBe(before?.last_seen_at.getTime());
      expect(userWithinCadence?.last_seen_at.getTime()).toBe(userBefore?.last_seen_at.getTime());

      await sql`
        update app_private.user_sessions
        set last_seen_at = clock_timestamp() - interval '2 hours'
        where token_hash = ${tokenHash}
      `;
      await sql`
        update public.users
        set last_seen_at = clock_timestamp() - interval '2 hours'
        where id = ${initial.row.id}
      `;
      const staleDb = createDatabaseInvocation(env);
      try {
        await findSessionAuthUser(env, initial.token, staleDb);
      } finally {
        await staleDb.dispose();
      }
      const [afterCadence] = await sql<{ last_seen_at: Date }[]>`
        select last_seen_at from app_private.user_sessions where token_hash = ${tokenHash}
      `;
      const [userAfterCadence] = await sql<{ last_seen_at: Date }[]>`
        select last_seen_at from public.users where id = ${initial.row.id}
      `;
      expect(afterCadence?.last_seen_at.getTime()).toBeGreaterThan(withinCadence?.last_seen_at.getTime() ?? 0);
      expect(userAfterCadence?.last_seen_at.getTime()).toBeGreaterThan(userWithinCadence?.last_seen_at.getTime() ?? 0);
    } finally {
      await cleanupUser(initial.row.id, telegramId);
    }
  });
});
