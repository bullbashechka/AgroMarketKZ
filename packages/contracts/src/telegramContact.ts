import { z } from "zod";
import { TELEGRAM_CONTACT_MAX } from "./constants";

const TELEGRAM_HANDLE_PATTERN = /^[A-Za-z][A-Za-z0-9_]{4,31}$/;

function extractTelegramHandle(raw: string): string | null {
  const trimmed = raw.trim();
  const httpsMatch = /^https:\/\/t\.me\/(.+)$/i.exec(trimmed);
  let candidate: string;
  if (httpsMatch?.[1]) {
    candidate = httpsMatch[1];
  } else if (/^https?:\/\//i.test(trimmed)) {
    return null;
  } else if (/^t\.me\//i.test(trimmed)) {
    candidate = trimmed.replace(/^t\.me\//i, "");
  } else {
    candidate = trimmed.replace(/^@/, "");
  }
  return TELEGRAM_HANDLE_PATTERN.test(candidate) ? candidate : null;
}

/**
 * Принимает `@handle`, `handle`, `t.me/handle` или `https://t.me/handle`, отклоняет
 * остальное (другие схемы/хосты, некорректный handle); канонизирует в `https://t.me/<handle>`.
 */
export const telegramContactSchema = z
  .string()
  .trim()
  .max(TELEGRAM_CONTACT_MAX)
  .transform((val, ctx) => {
    const handle = extractTelegramHandle(val);
    if (!handle) {
      ctx.addIssue({ code: "custom", message: "Введите корректный Telegram-контакт" });
      return z.NEVER;
    }
    return `https://t.me/${handle}`;
  });
