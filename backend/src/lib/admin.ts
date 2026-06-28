import type { AppEnv } from "../env";

/**
 * Парсит `ADMIN_ALLOWLIST` в множество числовых Telegram id.
 * Формат: значения через запятую; записи-username (нечисловые) игнорируются —
 * матч строго по неизменяемому числовому id (username можно перехватить сменой).
 */
export function parseAllowlist(env: AppEnv): Set<number> {
  const ids = new Set<number>();
  for (const part of (env.ADMIN_ALLOWLIST ?? "").split(",")) {
    const token = part.trim().replace(/^@/, "");
    if (/^\d+$/.test(token)) {
      ids.add(Number(token));
    }
  }
  return ids;
}

/** Является ли пользователь администратором — живая проверка по актуальному списку. */
export function isAdmin(telegramId: number, env: AppEnv): boolean {
  return parseAllowlist(env).has(telegramId);
}
