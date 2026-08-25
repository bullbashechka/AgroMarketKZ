import { getDb } from "../db";
import type { AppEnv } from "../env";
import {
  createSessionToken,
  hashSessionToken,
  SESSION_GRACE_SECONDS,
  SESSION_ROTATION_SECONDS,
  SESSION_TTL_SECONDS,
} from "../lib/session";

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
}

export async function createUserSession(env: AppEnv, userId: string): Promise<string> {
  const token = createSessionToken();
  const tokenHash = await hashSessionToken(token);
  const sql = getDb(env);
  await sql`
    insert into app_private.user_sessions (user_id, token_hash, expires_at)
    values (${userId}, ${tokenHash}, now() + (${SESSION_TTL_SECONDS} * interval '1 second'))
  `;
  return token;
}

export async function findSessionAuthUser(
  env: AppEnv,
  token: string,
): Promise<SessionAuthUser | undefined> {
  const tokenHash = await hashSessionToken(token);
  const sql = getDb(env);
  const [row] = await sql<SessionRow[]>`
    select s.id, s.user_id, u.telegram_id, u.registered_at, s.created_at, s.expires_at, s.rotated_at
    from app_private.user_sessions s
    join public.users u on u.id = s.user_id
    where s.token_hash = ${tokenHash}
      and s.revoked_at is null
      and s.expires_at > now()
      and (
        s.replacement_session_id is null
        or s.grace_expires_at > now()
      )
    limit 1
  `;
  if (!row) return undefined;

  let rotatedToken: string | undefined;
  if (!row.rotated_at && Date.now() - row.created_at.getTime() >= SESSION_ROTATION_SECONDS * 1000) {
    const nextToken = createSessionToken();
    const nextHash = await hashSessionToken(nextToken);
    const [replacement] = await sql<{ id: string }[]>`
      insert into app_private.user_sessions (user_id, token_hash, expires_at)
      values (${row.user_id}, ${nextHash}, ${row.expires_at})
      returning id
    `;
    const updated = await sql<{ id: string }[]>`
      update app_private.user_sessions
      set rotated_at = now(),
          replacement_session_id = ${replacement!.id},
          grace_expires_at = now() + (${SESSION_GRACE_SECONDS} * interval '1 second'),
          last_seen_at = now()
      where id = ${row.id} and rotated_at is null
      returning id
    `;
    if (updated.length === 1) rotatedToken = nextToken;
  } else {
    await sql`update app_private.user_sessions set last_seen_at = now() where id = ${row.id}`;
  }

  await sql`update public.users set last_seen_at = now() where id = ${row.user_id}`;
  return {
    sessionId: row.id,
    userId: row.user_id,
    telegramId: Number(row.telegram_id),
    isRegistered: row.registered_at !== null,
    token,
    rotatedToken,
  };
}

export async function revokeSession(env: AppEnv, token: string): Promise<void> {
  const tokenHash = await hashSessionToken(token);
  const sql = getDb(env);
  await sql`
    update app_private.user_sessions
    set revoked_at = now()
    where token_hash = ${tokenHash} and revoked_at is null
  `;
}

export async function revokeAllUserSessions(env: AppEnv, userId: string): Promise<boolean> {
  const sql = getDb(env);
  const rows = await sql<{ id: string }[]>`
    update app_private.user_sessions
    set revoked_at = now()
    where user_id = ${userId} and revoked_at is null
    returning id
  `;
  return rows.length > 0;
}
