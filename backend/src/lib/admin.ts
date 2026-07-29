import type { AppEnv } from "../env";
import { looksSyntheticTelegramId, parseTelegramIdToken } from "./telegramId";

interface AllowlistCache {
  raw: string;
  ids: ReadonlySet<number>;
}

let cache: AllowlistCache | undefined;

function warningToken(token: string): string {
  return token.length <= 24 ? token : `${token.slice(0, 23)}…`;
}

/**
 * Парсит `ADMIN_ALLOWLIST` в множество числовых Telegram id.
 * Кеш ключуется исходной строкой: смена секрета применяется на первом следующем запросе.
 */
export function parseAllowlist(env: AppEnv): ReadonlySet<number> {
  const raw = env.ADMIN_ALLOWLIST ?? "";
  if (cache?.raw === raw) return cache.ids;

  const ids = new Set<number>();
  const rejected: string[] = [];

  for (const part of raw.split(",")) {
    const token = part.trim();
    if (!token && raw.trim() === "") continue;
    const id = parseTelegramIdToken(token);
    if (id === null) {
      rejected.push(token);
      continue;
    }
    ids.add(id);
  }

  if (ids.size === 0) {
    console.warn("ADMIN_ALLOWLIST пуст или не содержит валидных Telegram id — админка недоступна");
  }
  if (rejected.length > 0) {
    const samples = rejected.slice(0, 5).map(warningToken);
    console.warn(
      `ADMIN_ALLOWLIST: отбраковано записей: ${rejected.length}; примеры: ${samples.join(", ")}`
    );
  }

  const syntheticIds = [...ids].filter(looksSyntheticTelegramId);
  if (syntheticIds.length > 0) {
    console.warn(
      `ADMIN_ALLOWLIST содержит синтетические Telegram id: ${syntheticIds.slice(0, 5).join(", ")}`
    );
  }

  cache = { raw, ids };
  return ids;
}

/** Является ли пользователь администратором — живая проверка по актуальному списку. */
export function isAdmin(telegramId: number, env: AppEnv): boolean {
  return parseAllowlist(env).has(telegramId);
}
