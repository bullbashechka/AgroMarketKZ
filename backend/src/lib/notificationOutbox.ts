import type { AppEnv } from "../env";
import { getDb } from "../db";
import { HttpError } from "./errors";
import {
  buildRequestDeepLink,
  escapeHtml,
  formatFeedbackNotification,
  formatRequestNotification,
  sendAdminNotificationResult,
} from "./telegramBot";
import { getAdminChatId } from "../repos/settings";
import { toRequest, type RequestRow } from "../repos/requests";
import type { FeedbackRow } from "../repos/feedback";

export interface NotificationQueueMessage {
  outboxId: string;
}

interface OutboxRow {
  id: string;
  event_type: "request" | "feedback";
  request_id: string | null;
  feedback_id: string | null;
  attempts: number;
}

const MAX_OUTBOX_ATTEMPTS = 20;
const MAX_RETRY_DELAY_SECONDS = 60 * 60;

function retryDelaySeconds(attempts: number): number {
  return Math.min(MAX_RETRY_DELAY_SECONDS, Math.max(30, 2 ** Math.min(attempts, 10)));
}

async function claimOutbox(env: AppEnv, outboxId: string): Promise<OutboxRow | undefined> {
  const sql = getDb(env);
  const [row] = await sql<OutboxRow[]>`
    update app_private.notification_outbox
    set status = 'processing',
        attempts = attempts + 1,
        processing_at = now()
    where id = ${outboxId}
      and (
        (status = 'pending' and next_attempt_at <= now())
        or (status = 'processing' and processing_at < now() - interval '10 minutes')
      )
    returning id, event_type, request_id, feedback_id, attempts
  `;
  return row;
}

async function markSent(env: AppEnv, outboxId: string): Promise<void> {
  const sql = getDb(env);
  await sql`
    update app_private.notification_outbox
    set status = 'sent', sent_at = now(), processing_at = null, last_error = null
    where id = ${outboxId}
  `;
}

async function markFailure(env: AppEnv, outboxId: string, attempts: number, error: string): Promise<void> {
  const sql = getDb(env);
  const status = attempts >= MAX_OUTBOX_ATTEMPTS ? "dead_letter" : "pending";
  await sql`
    update app_private.notification_outbox
    set status = ${status},
        processing_at = null,
        next_attempt_at = now() + (${retryDelaySeconds(attempts)} * interval '1 second'),
        last_error = ${error.slice(0, 500)}
    where id = ${outboxId}
  `;
}

function appendEventId(html: string, outboxId: string): string {
  return `${html}\n<code>Событие: ${escapeHtml(outboxId)}</code>`;
}

async function sendRequestNotification(env: AppEnv, outbox: OutboxRow, chatId: string): Promise<boolean> {
  if (!outbox.request_id) throw new HttpError(500, "Уведомление заявки не связано с заявкой");
  const sql = getDb(env);
  const [row] = await sql<RequestRow[]>`select * from requests where id = ${outbox.request_id}`;
  if (!row) throw new HttpError(404, "Заявка для уведомления не найдена");
  const request = await toRequest(env, row);
  const [user] = await sql<{ telegram_username: string | null }[]>`
    select telegram_username from users where id = ${row.user_id}
  `;
  const html = formatRequestNotification({
    source: row.source,
    tabType: row.tab_type,
    cardTitleSnapshot: row.card_title_snapshot,
    cardPriceTypeSnapshot: row.card_price_type_snapshot,
    cardPriceAmountSnapshot: row.card_price_amount_snapshot,
    cardPriceUnitSnapshot: row.card_price_unit_snapshot,
    cardPriceReasonSnapshot: row.card_price_reason_snapshot,
    contactName: row.contact_name,
    contactPhone: row.contact_phone,
    contactPhoneVerified: row.contact_phone_verified,
    comment: row.comment,
    listingSubmission: request.listingSubmission,
    telegramUsername: user?.telegram_username ?? null,
  });
  const deepLink = buildRequestDeepLink(env, row.id);
  const replyMarkup = deepLink
    ? { inline_keyboard: [[{ text: "Открыть заявку", url: deepLink }]] }
    : undefined;
  return sendAdminNotificationResult(env, chatId, appendEventId(html, outbox.id), replyMarkup);
}

async function sendFeedbackNotification(env: AppEnv, outbox: OutboxRow, chatId: string): Promise<boolean> {
  if (!outbox.feedback_id) throw new HttpError(500, "Уведомление feedback не связано с обращением");
  const sql = getDb(env);
  const [row] = await sql<FeedbackRow[]>`select * from feedback_messages where id = ${outbox.feedback_id}`;
  if (!row) throw new HttpError(404, "Обращение для уведомления не найдено");
  const [user] = await sql<{ telegram_username: string | null }[]>`
    select telegram_username from users where id = ${row.user_id}
  `;
  const html = formatFeedbackNotification({
    contactName: row.contact_name,
    contactPhone: row.contact_phone,
    contactPhoneVerified: row.contact_phone_verified,
    message: row.message,
    telegramUsername: user?.telegram_username ?? null,
  });
  return sendAdminNotificationResult(env, chatId, appendEventId(html, outbox.id));
}

/** Processes one claimed event. False means it remains durable for retry. */
export async function processNotificationOutbox(
  env: AppEnv,
  outboxId: string,
): Promise<boolean> {
  const outbox = await claimOutbox(env, outboxId);
  if (!outbox) return true;

  const chatId = await getAdminChatId(env);
  if (!chatId) {
    await markFailure(env, outboxId, outbox.attempts, "admin_chat_id is not configured");
    return false;
  }

  try {
    const delivered = outbox.event_type === "request"
      ? await sendRequestNotification(env, outbox, chatId)
      : await sendFeedbackNotification(env, outbox, chatId);
    if (delivered) {
      await markSent(env, outboxId);
      return true;
    }
    await markFailure(env, outboxId, outbox.attempts, "Telegram Bot API rejected the message");
    return false;
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown notification error";
    await markFailure(env, outboxId, outbox.attempts, message);
    return false;
  }
}

export async function dispatchNotificationOutbox(
  env: AppEnv,
  outboxId: string,
): Promise<void> {
  if (env.NOTIFICATION_QUEUE) {
    await env.NOTIFICATION_QUEUE.send({ outboxId });
    return;
  }
  await processNotificationOutbox(env, outboxId);
}

/** Enqueues an event or processes it directly when local bindings are absent. */
export async function dispatchNotificationForEntity(
  env: AppEnv,
  eventType: "request" | "feedback",
  entityId: string,
): Promise<void> {
  const sql = getDb(env);
  const [row] = eventType === "request"
    ? await sql<Pick<OutboxRow, "id">[]>`
        select id from app_private.notification_outbox
        where request_id = ${entityId}
          and status in ('pending', 'processing')
        order by created_at
        limit 1
      `
    : await sql<Pick<OutboxRow, "id">[]>`
        select id from app_private.notification_outbox
        where feedback_id = ${entityId}
          and status in ('pending', 'processing')
        order by created_at
        limit 1
      `;
  if (!row) return;
  await dispatchNotificationOutbox(env, row.id);
}

/** Reconciles events whose enqueue ack was lost; safe to run from cron. */
export async function reconcileNotificationOutbox(env: AppEnv): Promise<void> {
  const sql = getDb(env);
  const rows = await sql<Pick<OutboxRow, "id">[]>`
    select id from app_private.notification_outbox
    where status = 'pending' and next_attempt_at <= now()
    order by created_at
    limit 50
  `;
  for (const row of rows) {
    await dispatchNotificationOutbox(env, row.id).catch((error) => {
      console.error("notification outbox reconcile failed", { outboxId: row.id, error });
    });
  }
}
