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

function formatPrice(priceType: PriceType, priceAmount: number | null): string {
  if (priceType === "on_request" || priceAmount === null) return priceTypeLabels.on_request;
  return `${priceAmount.toLocaleString("ru-RU")} ₸`;
}

export interface RequestNotificationInput {
  source: RequestSource;
  tabType: CatalogType | null;
  cardTitleSnapshot: string | null;
  cardPriceTypeSnapshot: PriceType | null;
  cardPriceAmountSnapshot: number | null;
  contactName: string;
  contactPhone: string;
  comment: string | null;
  telegramUsername: string | null;
}

/** Формирует HTML-сообщение о новой заявке для чата администраторов. */
export function formatRequestNotification(input: RequestNotificationInput): string {
  const lines = ["<b>Новая заявка</b>", `Источник: ${escapeHtml(requestSourceLabels[input.source])}`];

  if (input.source === "card" && input.cardTitleSnapshot && input.cardPriceTypeSnapshot) {
    lines.push(`Карточка: ${escapeHtml(input.cardTitleSnapshot)}`);
    lines.push(
      `Цена: ${escapeHtml(formatPrice(input.cardPriceTypeSnapshot, input.cardPriceAmountSnapshot))}`
    );
  }
  if (input.source === "tab" && input.tabType) {
    lines.push(`Вкладка: ${escapeHtml(catalogTypeTabLabels[input.tabType])}`);
  }

  lines.push(`Имя: ${escapeHtml(input.contactName)}`);
  lines.push(`Телефон: ${escapeHtml(input.contactPhone)}`);
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
  message: string;
  telegramUsername: string | null;
}

/** Формирует HTML-сообщение о новом обращении обратной связи для чата администраторов. */
export function formatFeedbackNotification(input: FeedbackNotificationInput): string {
  const lines = [
    "<b>Обратная связь</b>",
    `Имя: ${escapeHtml(input.contactName)}`,
    `Телефон: ${escapeHtml(input.contactPhone)}`
  ];
  if (input.telegramUsername) {
    lines.push(`Telegram: @${escapeHtml(input.telegramUsername)}`);
  }
  lines.push(`Сообщение: ${escapeHtml(input.message)}`);
  return lines.join("\n");
}

/**
 * Отправляет уведомление в чат администраторов через Bot API. Best-effort:
 * любая ошибка логируется и проглатывается — сбой не должен ломать создание
 * заявки/сообщения обратной связи, повторных попыток нет.
 */
export async function sendAdminNotification(env: AppEnv, chatId: string, html: string): Promise<void> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: html, parse_mode: "HTML" })
    });
    if (!res.ok) {
      console.error("sendAdminNotification: Telegram API вернул ошибку", res.status, await res.text());
    }
  } catch (err) {
    console.error("sendAdminNotification: не удалось отправить уведомление", err);
  }
}
