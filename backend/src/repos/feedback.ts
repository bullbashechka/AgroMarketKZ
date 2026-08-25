import type { CreateFeedbackInput, FeedbackMessage } from "@agromarket/contracts";
import { getDb } from "../db";
import type { AppEnv } from "../env";
import { HttpError } from "../lib/errors";
import { assertUnderLimit, retryAfterSeconds } from "../lib/rateLimit";

export interface FeedbackRow {
  id: string;
  user_id: string;
  contact_name: string;
  contact_phone: string;
  contact_phone_verified: boolean;
  message: string;
  created_at: Date;
}

export function toFeedbackMessage(row: FeedbackRow): FeedbackMessage {
  return {
    id: row.id,
    userId: row.user_id,
    contactName: row.contact_name,
    contactPhone: row.contact_phone,
    contactPhoneVerified: row.contact_phone_verified,
    message: row.message,
    createdAt: row.created_at.toISOString()
  };
}

/**
 * Создаёт обращение обратной связи. Лимит 5/10 мин проверяется внутри транзакции
 * после блокировки строки пользователя — так же, как в заявках (см. repos/requests.ts).
 */
export async function createFeedback(
  env: AppEnv,
  userId: string,
  input: CreateFeedbackInput
): Promise<FeedbackRow> {
  const sql = getDb(env);
  return sql.begin(async (tx) => {
    const [user] = await tx<{ verified_phone: string | null }[]>`
      select verified_phone from users where id = ${userId} for update
    `;
    if (!user) throw new HttpError(404, "Пользователь не найден");

    const [rate] = await tx<{ count: string; oldest: Date | null }[]>`
      select count(*), min(created_at) as oldest from feedback_messages
      where user_id = ${userId} and created_at > now() - interval '10 minutes'
    `;
    assertUnderLimit(Number(rate?.count ?? 0), retryAfterSeconds(rate?.oldest ?? null));

    const [row] = await tx<FeedbackRow[]>`
      insert into feedback_messages (user_id, contact_name, contact_phone, contact_phone_verified, message)
      values (
        ${userId}, ${input.contactName}, ${input.contactPhone},
        ${user.verified_phone === input.contactPhone},
        ${input.message}
      )
      returning *
    `;
    await tx`
      insert into app_private.notification_outbox (event_type, feedback_id)
      values ('feedback', ${row!.id})
      on conflict (feedback_id) where feedback_id is not null do nothing
    `;
    return row!;
  });
}
