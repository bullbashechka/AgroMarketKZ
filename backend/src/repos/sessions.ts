import type { Sql, TransactionSql } from "postgres";
import type { Database } from "../db";
import type { AppEnv } from "../env";
import { appendAdminAuditIntent, type AdminAuditInput } from "./adminAudit";
import { telegramIdentityHash } from "../lib/telegram";
import {
  createSessionToken,
  deriveSessionRotationToken,
  hashSessionToken,
  SESSION_ACTIVITY_THROTTLE_SECONDS,
  SESSION_GRACE_SECONDS,
  SESSION_ROTATION_SECONDS,
  SESSION_TTL_SECONDS,
} from "../lib/session";
import type { TelegramUser, UserRow } from "./users";
import { consumeWidgetAuthProofInTransaction } from "./authProofs";
import {
  advanceTelegramAuthCutoff,
  assertTelegramAuthAllowed,
  lockTelegramIdentity,
} from "./telegramAuthCutoff";

export interface SessionAuthUser {
  sessionId: string;
  userId: string;
  telegramId: number;
  isRegistered: boolean;
  token: string;
  rotatedToken?: string;
}

interface SessionRow {
  id: string;
  user_id: string;
  telegram_id: string;
  registered_at: Date | null;
  created_at: Date;
  expires_at: Date;
  rotated_at: Date | null;
  replacement_session_id: string | null;
  grace_expires_at: Date | null;
}

export interface TelegramSessionExchange {
  row: UserRow;
  token: string;
}

async function touchSessionActivity(
  sql: Sql | TransactionSql,
  sessionId: string,
  userId: string,
): Promise<void> {
  await sql`
    update app_private.user_sessions
    set last_seen_at = clock_timestamp()
    where id = ${sessionId}
      and last_seen_at < clock_timestamp() - (${SESSION_ACTIVITY_THROTTLE_SECONDS} * interval '1 second')
  `;
  await sql`
    update public.users
    set last_seen_at = clock_timestamp()
    where id = ${userId}
      and deleted_at is null
      and last_seen_at < clock_timestamp() - (${SESSION_ACTIVITY_THROTTLE_SECONDS} * interval '1 second')
  `;
}

/**
 * Atomically exchanges a verified Mini App proof for an opaque session. The
 * user row is locked before the identity advisory lock so exchange, revoke and
 * delete use one lock order even when the account is being anonymised.
 */
async function exchangeVerifiedTelegramSession(
  env: AppEnv,
  tg: TelegramUser,
  authDate: number,
  db: Database,
  consumeProof?: (tx: TransactionSql) => Promise<void>,
): Promise<TelegramSessionExchange> {
  const token = createSessionToken();
  const tokenHash = await hashSessionToken(token);
  const identityHash = await telegramIdentityHash(tg.id, env.TELEGRAM_BOT_TOKEN);

  const result = await db.sql.begin(async (tx) => {
    await tx`
      select id
      from public.users
      where telegram_id = ${tg.id} and deleted_at is null
      for update
    `;
    await lockTelegramIdentity(tx, identityHash);
    await assertTelegramAuthAllowed(tx, identityHash, authDate);
    if (consumeProof) await consumeProof(tx);

    const [row] = await tx<UserRow[]>`
      insert into public.users (telegram_id, telegram_username, telegram_first_name, telegram_last_name)
      values (${tg.id}, ${tg.username ?? null}, ${tg.firstName ?? null}, ${tg.lastName ?? null})
      on conflict (telegram_id) do update set
        telegram_username = excluded.telegram_username,
        telegram_first_name = excluded.telegram_first_name,
        telegram_last_name = excluded.telegram_last_name
      returning *
    `;
    if (!row) throw new Error("Не удалось создать пользователя Telegram");

    await tx`
      insert into app_private.user_sessions (user_id, token_hash, expires_at)
      values (${row.id}, ${tokenHash}, clock_timestamp() + (${SESSION_TTL_SECONDS} * interval '1 second'))
    `;
    return { row, token };
  });

  return result;
}

/** Exchanges a verified Mini App proof for one opaque session. */
export async function exchangeTelegramSession(
  env: AppEnv,
  tg: TelegramUser,
  authDate: number,
  db: Database,
): Promise<TelegramSessionExchange> {
  return exchangeVerifiedTelegramSession(env, tg, authDate, db);
}

/** Exchanges a verified one-use Login Widget proof atomically with its session. */
export async function exchangeWidgetTelegramSession(
  env: AppEnv,
  tg: TelegramUser,
  proofHash: string,
  authDate: number,
  db: Database,
): Promise<TelegramSessionExchange> {
  return exchangeVerifiedTelegramSession(
    env,
    tg,
    authDate,
    db,
    (tx) => consumeWidgetAuthProofInTransaction(proofHash, tg.id, authDate, tx),
  );
}

export async function createUserSession(env: AppEnv, userId: string, db: Database): Promise<string> {
  const token = createSessionToken();
  const tokenHash = await hashSessionToken(token);
  const sql = db.sql;
  await sql`
    insert into app_private.user_sessions (user_id, token_hash, expires_at)
    values (${userId}, ${tokenHash}, now() + (${SESSION_TTL_SECONDS} * interval '1 second'))
  `;
  return token;
}

export async function findSessionAuthUser(
  env: AppEnv,
  token: string,
  db: Database,
): Promise<SessionAuthUser | undefined> {
  const tokenHash = await hashSessionToken(token);
  const sql = db.sql;
  const [row] = await sql<SessionRow[]>`
    select s.id, s.user_id, u.telegram_id, u.registered_at, s.created_at, s.expires_at,
      s.rotated_at, s.replacement_session_id, s.grace_expires_at
    from app_private.user_sessions s
    join public.users u on u.id = s.user_id
    where s.token_hash = ${tokenHash}
      and u.deleted_at is null
      and s.revoked_at is null
      and s.expires_at > now()
      and (
        s.replacement_session_id is null
        or s.grace_expires_at > now()
      )
    limit 1
  `;
  if (!row) return undefined;

  let effectiveRow = row;
  let rotatedToken: string | undefined;
  const wasRotatedAtInitialRead = row.rotated_at !== null;
  const rotationDue = !wasRotatedAtInitialRead
    && Date.now() - row.created_at.getTime() >= SESSION_ROTATION_SECONDS * 1000;
  const recoveryWindowOpen = wasRotatedAtInitialRead && row.replacement_session_id !== null && row.grace_expires_at !== null;
  if (rotationDue || recoveryWindowOpen) {
    const nextToken = await deriveSessionRotationToken(token, env.TELEGRAM_BOT_TOKEN);
    const nextHash = await hashSessionToken(nextToken);
    const rotation = await sql.begin(async (tx) => {
      const [user] = await tx<{ telegram_id: string; registered_at: Date | null }[]>`
        select telegram_id, registered_at
        from public.users
        where id = ${row.user_id} and deleted_at is null
        for update
      `;
      if (!user) return undefined;

      const [lockedSession] = await tx<Omit<SessionRow, "telegram_id" | "registered_at">[]>`
        select id, user_id, created_at, expires_at, rotated_at, replacement_session_id, grace_expires_at
        from app_private.user_sessions
        where id = ${row.id}
          and token_hash = ${tokenHash}
          and revoked_at is null
          and expires_at > clock_timestamp()
          and (
            replacement_session_id is null
            or grace_expires_at > clock_timestamp()
          )
        for update
      `;
      if (!lockedSession) return undefined;

      const lockedRow: SessionRow = {
        ...lockedSession,
        telegram_id: user.telegram_id,
        registered_at: user.registered_at,
      };
      let rotatedToken: string | undefined;
      if (!lockedRow.rotated_at && Date.now() - lockedRow.created_at.getTime() >= SESSION_ROTATION_SECONDS * 1000) {
        const [replacement] = await tx<{ id: string }[]>`
          insert into app_private.user_sessions (user_id, token_hash, expires_at)
          values (${lockedRow.user_id}, ${nextHash}, ${lockedRow.expires_at})
          returning id
        `;
        if (!replacement) throw new Error("Не удалось создать replacement session");
        const [updated] = await tx<{ id: string }[]>`
          update app_private.user_sessions
          set rotated_at = clock_timestamp(),
              replacement_session_id = ${replacement.id},
              grace_expires_at = clock_timestamp() + (${SESSION_GRACE_SECONDS} * interval '1 second'),
              last_seen_at = clock_timestamp()
          where id = ${lockedRow.id} and rotated_at is null
          returning id
        `;
        if (!updated) throw new Error("Не удалось связать replacement session");
        rotatedToken = nextToken;
      } else if (
        wasRotatedAtInitialRead
        && lockedRow.rotated_at
        && lockedRow.replacement_session_id
        && lockedRow.grace_expires_at
      ) {
        const [replacement] = await tx<{ token_hash: string }[]>`
          select token_hash
          from app_private.user_sessions
          where id = ${lockedRow.replacement_session_id}
            and user_id = ${lockedRow.user_id}
            and token_hash = ${nextHash}
            and revoked_at is null
            and expires_at > clock_timestamp()
        `;
        if (replacement) rotatedToken = nextToken;
      }
      await touchSessionActivity(tx, lockedRow.id, lockedRow.user_id);
      return { row: lockedRow, rotatedToken };
    });
    if (!rotation) return undefined;
    effectiveRow = rotation.row;
    rotatedToken = rotation.rotatedToken;
  } else {
    await touchSessionActivity(sql, row.id, row.user_id);
  }

  return {
    sessionId: effectiveRow.id,
    userId: effectiveRow.user_id,
    telegramId: Number(effectiveRow.telegram_id),
    isRegistered: effectiveRow.registered_at !== null,
    token,
    rotatedToken,
  };
}

export async function revokeSession(env: AppEnv, token: string, db: Database): Promise<void> {
  const tokenHash = await hashSessionToken(token);
  const sql = db.sql;
  const [candidate] = await sql<{ user_id: string }[]>`
    select s.user_id
    from app_private.user_sessions s
    join public.users u on u.id = s.user_id
    where s.token_hash = ${tokenHash}
      and s.revoked_at is null
      and u.deleted_at is null
    limit 1
  `;
  if (!candidate) return;

  await sql.begin(async (tx) => {
    const [user] = await tx<{ id: string }[]>`
      select id
      from public.users
      where id = ${candidate.user_id} and deleted_at is null
      for update
    `;
    if (!user) return;

    const [session] = await tx<{ id: string; user_id: string }[]>`
      select s.id, s.user_id
      from app_private.user_sessions s
      where s.user_id = ${candidate.user_id}
        and s.token_hash = ${tokenHash}
        and s.revoked_at is null
      for update
    `;
    if (!session) return;

    // Revoke the presented session and every linked generation. The user lock
    // serializes this walk with rotation, full revoke, and account deletion.
    await tx`
      with recursive linked(id) as (
        select ${session.id}::uuid
        union
        select case
          when s.id = linked.id then s.replacement_session_id
          else s.id
        end
        from app_private.user_sessions s
        join linked on linked.id = s.id or linked.id = s.replacement_session_id
        where s.user_id = ${session.user_id}
          and (
            (s.id = linked.id and s.replacement_session_id is not null)
            or s.replacement_session_id = linked.id
          )
      )
      update app_private.user_sessions s
      set revoked_at = clock_timestamp()
      where s.user_id = ${session.user_id}
        and s.id in (select id from linked)
        and s.revoked_at is null
    `;
  });
}

export async function revokeAllUserSessions(
  env: AppEnv,
  userId: string,
  db: Database,
  audit?: AdminAuditInput,
): Promise<boolean> {
  const sql = db.sql;
  const [candidate] = await sql<{ telegram_id: string }[]>`
    select telegram_id
    from public.users
    where id = ${userId} and deleted_at is null
  `;
  if (!candidate) {
    if (audit) {
      await sql.begin(async (tx) => appendAdminAuditIntent(tx, audit));
    }
    return false;
  }

  const identityHash = await telegramIdentityHash(Number(candidate.telegram_id), env.TELEGRAM_BOT_TOKEN);
  return sql.begin(async (tx) => {
    const [user] = await tx<{ telegram_id: string }[]>`
      select telegram_id
      from public.users
      where id = ${userId} and deleted_at is null
      for update
    `;
    if (!user) {
      if (audit) await appendAdminAuditIntent(tx, audit);
      return false;
    }

    await lockTelegramIdentity(tx, identityHash);
    await advanceTelegramAuthCutoff(tx, identityHash);
    const rows = await tx<{ id: string }[]>`
      update app_private.user_sessions
      set revoked_at = clock_timestamp()
      where user_id = ${userId} and revoked_at is null
      returning id
    `;
    if (audit) await appendAdminAuditIntent(tx, audit);
    return rows.length > 0;
  });
}
