import type { CreateFeedbackInput, FeedbackMessage } from "@agromarket/contracts";
import { getDb } from "../db";
import type { AppEnv } from "../env";

export interface FeedbackRow {
  id: string;
  user_id: string;
  contact_name: string;
  contact_phone: string;
  message: string;
  created_at: Date;
}

export function toFeedbackMessage(row: FeedbackRow): FeedbackMessage {
  return {
    id: row.id,
    userId: row.user_id,
    contactName: row.contact_name,
    contactPhone: row.contact_phone,
    message: row.message,
    createdAt: row.created_at.toISOString()
  };
}

/** Число сообщений обратной связи пользователя за последние 10 минут — антиспам-лимит. */
export async function countRecentFeedback(env: AppEnv, userId: string): Promise<number> {
  const sql = getDb(env);
  const [row] = await sql<{ count: string }[]>`
    select count(*) from feedback_messages
    where user_id = ${userId} and created_at > now() - interval '10 minutes'
  `;
  return Number(row?.count ?? 0);
}

export async function createFeedback(
  env: AppEnv,
  userId: string,
  input: CreateFeedbackInput
): Promise<FeedbackRow> {
  const sql = getDb(env);
  const [row] = await sql<FeedbackRow[]>`
    insert into feedback_messages (user_id, contact_name, contact_phone, message)
    values (${userId}, ${input.contactName}, ${input.contactPhone}, ${input.message})
    returning *
  `;
  return row!;
}
