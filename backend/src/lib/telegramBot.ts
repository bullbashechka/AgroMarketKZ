import {
  catalogTypeTabLabels,
  priceTypeLabels,
  requestSourceLabels,
  type CatalogType,
  type PriceType,
  type RequestSource
} from "@agromarket/contracts";
import type { AppEnv } from "../env";

/** Экранирует спецсимволы для Telegram `parse_mode: "HTML"`. */
export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function formatPrice(priceType: PriceType, priceAmount: number | null, priceUnit: string | null): string {
  if (priceType === "on_request" || priceAmount === null) return priceTypeLabels.on_request;
  const prefix = priceType === "from" ? "от " : "";
  return `${prefix}${priceAmount.toLocaleString("ru-RU")} ₸${priceUnit ? ` ${priceUnit}` : ""}`;
}

/** Строка телефона с отметкой верификации через Telegram. */
function formatPhoneLine(phone: string, verified: boolean): string {
  const suffix = verified ? " ✓ подтверждён через Telegram" : "";
  return `Телефон: ${escapeHtml(phone)}${suffix}`;
}

export interface RequestNotificationInput {
  source: RequestSource;
  tabType: CatalogType | null;
  cardTitleSnapshot: string | null;
  cardPriceTypeSnapshot: PriceType | null;
  cardPriceAmountSnapshot: number | null;
  cardPriceUnitSnapshot: string | null;
  cardPriceReasonSnapshot: string | null;
  contactName: string;
  contactPhone: string;
  contactPhoneVerified: boolean;
  comment: string | null;
  telegramUsername: string | null;
}

/** Формирует HTML-сообщение о новой заявке для чата администраторов. */
export function formatRequestNotification(input: RequestNotificationInput): string {
  const lines = ["<b>Новая заявка</b>", `Источник: ${escapeHtml(requestSourceLabels[input.source])}`];

  if (input.source === "card" && input.cardTitleSnapshot && input.cardPriceTypeSnapshot) {
    lines.push(`Карточка: ${escapeHtml(input.cardTitleSnapshot)}`);
    lines.push(
      `Цена: ${escapeHtml(formatPrice(input.cardPriceTypeSnapshot, input.cardPriceAmountSnapshot, input.cardPriceUnitSnapshot))}`
    );
    if (input.cardPriceReasonSnapshot) {
      lines.push(`Расчёт: ${escapeHtml(input.cardPriceReasonSnapshot)}`);
    }
  }
  if (input.source === "tab" && input.tabType) {
    lines.push(`Вкладка: ${escapeHtml(catalogTypeTabLabels[input.tabType])}`);
  }

  lines.push(`Имя: ${escapeHtml(input.contactName)}`);
  lines.push(formatPhoneLine(input.contactPhone, input.contactPhoneVerified));
  if (input.telegramUsername) {
    lines.push(`Telegram: @${escapeHtml(input.telegramUsername)}`);
  }
  if (input.comment) {
    lines.push(`Комментарий: ${escapeHtml(input.comment)}`);
  }

  return lines.join("\n");
}

export interface FeedbackNotificationInput {
  contactName: string;
  contactPhone: string;
  contactPhoneVerified: boolean;
  message: string;
  telegramUsername: string | null;
}

/** Формирует HTML-сообщение о новом обращении обратной связи для чата администраторов. */
export function formatFeedbackNotification(input: FeedbackNotificationInput): string {
  const lines = [
    "<b>Обратная связь</b>",
    `Имя: ${escapeHtml(input.contactName)}`,
    formatPhoneLine(input.contactPhone, input.contactPhoneVerified)
  ];
  if (input.telegramUsername) {
    lines.push(`Telegram: @${escapeHtml(input.telegramUsername)}`);
  }
  lines.push(`Сообщение: ${escapeHtml(input.message)}`);
  return lines.join("\n");
}

/** Inline-клавиатура Bot API (используем только URL-кнопки). */
export interface InlineKeyboardMarkup {
  inline_keyboard: { text: string; url: string }[][];
}

/**
 * Deep link на заявку в админке через Mini App: `t.me/<бот>/<приложение>?startapp=…`.
 * Возвращает `null`, если username бота или shortname Mini App не заданы в окружении —
 * тогда кнопка в уведомлении просто опускается.
 */
export function buildRequestDeepLink(env: AppEnv, requestId: string): string | null {
  if (!env.TELEGRAM_BOT_USERNAME || !env.TELEGRAM_MINIAPP_SHORTNAME) return null;
  return `https://t.me/${env.TELEGRAM_BOT_USERNAME}/${env.TELEGRAM_MINIAPP_SHORTNAME}?startapp=request_${requestId}`;
}

/**
 * Одна попытка отправки сообщения через Bot API. Возвращает успех/неуспех,
 * не бросает — сетевые ошибки и ошибки API логируются.
 */
export async function sendTelegramMessage(
  env: AppEnv,
  chatId: string,
  html: string,
  replyMarkup?: InlineKeyboardMarkup
): Promise<boolean> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: html,
        parse_mode: "HTML",
        ...(replyMarkup ? { reply_markup: replyMarkup } : {})
      })
    });
    if (!res.ok) {
      console.error("sendTelegramMessage: Telegram API вернул ошибку", res.status, await res.text());
      return false;
    }
    return true;
  } catch (err) {
    console.error("sendTelegramMessage: не удалось отправить сообщение", err);
    return false;
  }
}

/**
 * Отправляет уведомление в чат администраторов через Bot API. Best-effort
 * с одной немедленной повторной попыткой: сбой не должен ломать создание
 * заявки/сообщения обратной связи (заявка в любом случае видна в админке).
 */
export async function sendAdminNotification(
  env: AppEnv,
  chatId: string,
  html: string,
  replyMarkup?: InlineKeyboardMarkup
): Promise<void> {
  if (await sendTelegramMessage(env, chatId, html, replyMarkup)) return;
  await new Promise((resolve) => setTimeout(resolve, 500));
  if (!(await sendTelegramMessage(env, chatId, html, replyMarkup))) {
    console.error("sendAdminNotification: уведомление не доставлено после повторной попытки");
  }
}
