import { z } from "zod";
import { TELEGRAM_CONTACT_MAX } from "./constants";

const TELEGRAM_HANDLE_PATTERN = /^[A-Za-z][A-Za-z0-9_]{4,31}$/;

function extractTelegramHandle(raw: string): string | null {
  const trimmed = raw.trim();
  const isOtherHttpUrl = /^https?:\/\//i.test(trimmed) && !/^https:\/\/t\.me\//i.test(trimmed);
  if (isOtherHttpUrl) return null;
  const candidate = trimmed.replace(/^(https:\/\/)?t\.me\//i, "").replace(/^@/, "");
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
