import type { WidgetLoginInput } from "@agromarket/contracts";
import type { TelegramUser } from "../repos/users";
import { HttpError } from "./errors";
import { isPlausibleTelegramId } from "./telegramId";

/** Окно свежести подписи Mini App — 24 часа. */
const INIT_DATA_MAX_AUTH_AGE_SEC = 24 * 60 * 60;
/** Login Widget redirect — одноразовый короткоживущий proof, не bearer-сессия. */
const WIDGET_MAX_AUTH_AGE_SEC = 5 * 60;
const MAX_FUTURE_SKEW_SEC = 30;

const encoder = new TextEncoder();

async function hmacSha256(keyBytes: ArrayBuffer | Uint8Array, message: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return new Uint8Array(sig);
}

async function sha256(message: string): Promise<ArrayBuffer> {
  return crypto.subtle.digest("SHA-256", encoder.encode(message));
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Сравнение строк за постоянное время (защита от тайминг-атак). */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function buildDataCheckString(entries: [string, string][]): string {
  return entries
    .filter(([key]) => key !== "hash")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
}

function assertFresh(authDate: number, maxAgeSec: number): void {
  const now = Math.floor(Date.now() / 1000);
  if (
    !Number.isFinite(authDate)
    || authDate > now + MAX_FUTURE_SKEW_SEC
    || now - authDate > maxAgeSec
  ) {
    throw new HttpError(401, "Данные авторизации устарели, попробуйте ещё раз");
  }
}

/**
 * Проверяет `initData` из Telegram Mini App (раздел 16): пересчитывает HMAC-подпись
 * `TELEGRAM_BOT_TOKEN`, сверяет с `hash`, проверяет свежесть `auth_date`.
 * Возвращает данные пользователя или бросает `HttpError(401)`.
 */
export async function validateInitData(initData: string, botToken: string): Promise<TelegramUser> {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) {
    throw new HttpError(401, "Отсутствует подпись Telegram");
  }

  const entries = [...params.entries()];
  const dataCheckString = buildDataCheckString(entries);

  // secret_key = HMAC_SHA256(key="WebAppData", data=bot_token)
  const secretKey = await hmacSha256(encoder.encode("WebAppData"), botToken);
  const computed = toHex(await hmacSha256(secretKey, dataCheckString));

  if (!timingSafeEqual(computed, hash)) {
    throw new HttpError(401, "Не удалось подтвердить личность Telegram");
  }

  assertFresh(Number(params.get("auth_date")), INIT_DATA_MAX_AUTH_AGE_SEC);

  const userRaw = params.get("user");
  if (!userRaw) {
    throw new HttpError(401, "Отсутствуют данные пользователя Telegram");
  }
  let user: {
    id?: number;
    username?: string;
    first_name?: string;
    last_name?: string;
  };
  try {
    const parsed: unknown = JSON.parse(userRaw);
    if (typeof parsed !== "object" || parsed === null) throw new Error("not an object");
    user = parsed as typeof user;
  } catch {
    throw new HttpError(401, "Некорректные данные пользователя Telegram");
  }
  if (!isPlausibleTelegramId(user.id)) {
    throw new HttpError(401, "Некорректный идентификатор Telegram");
  }

  return {
    id: user.id,
    username: user.username ?? null,
    firstName: user.first_name ?? null,
    lastName: user.last_name ?? null
  };
}

/** Окно свежести подписанного контакта: payload создаётся в момент шаринга. */
const CONTACT_MAX_AGE_SEC = 10 * 60;

/** Подтверждённый Telegram контакт из requestContact. */
export interface VerifiedContact {
  phoneNumber: string;
  userId: number;
}

/**
 * Проверяет подписанный ответ requestContact из Mini App (строка `event.response`
 * вида `contact=<json>&auth_date=…&hash=…`). Подпись считается тем же алгоритмом,
 * что и initData (secret = HMAC("WebAppData", bot_token)). Возвращает телефон и
 * telegram id владельца контакта; принадлежность контакта текущему пользователю
 * проверяет вызывающая сторона.
 */
export async function validateContactResponse(
  response: string,
  botToken: string
): Promise<VerifiedContact> {
  const params = new URLSearchParams(response);
  const hash = params.get("hash");
  if (!hash) {
    throw new HttpError(400, "Отсутствует подпись контакта Telegram");
  }

  const dataCheckString = buildDataCheckString([...params.entries()]);
  const secretKey = await hmacSha256(encoder.encode("WebAppData"), botToken);
  const computed = toHex(await hmacSha256(secretKey, dataCheckString));

  if (!timingSafeEqual(computed, hash)) {
    throw new HttpError(401, "Не удалось подтвердить контакт Telegram");
  }

  const authDate = Number(params.get("auth_date"));
  const now = Math.floor(Date.now() / 1000);
  if (
    !Number.isFinite(authDate)
    || authDate > now + MAX_FUTURE_SKEW_SEC
    || now - authDate > CONTACT_MAX_AGE_SEC
  ) {
    throw new HttpError(401, "Данные контакта устарели, поделитесь контактом ещё раз");
  }

  const contactRaw = params.get("contact");
  if (!contactRaw) {
    throw new HttpError(400, "Отсутствуют данные контакта Telegram");
  }
  let contact: { phone_number?: unknown; user_id?: unknown };
  try {
    const parsed: unknown = JSON.parse(contactRaw);
    if (typeof parsed !== "object" || parsed === null) throw new Error("not an object");
    contact = parsed as { phone_number?: unknown; user_id?: unknown };
  } catch {
    throw new HttpError(400, "Некорректные данные контакта Telegram");
  }
  if (
    typeof contact.phone_number !== "string"
    || contact.phone_number.trim().length === 0
    || !isPlausibleTelegramId(contact.user_id)
  ) {
    throw new HttpError(400, "Некорректные данные контакта Telegram");
  }

  return { phoneNumber: contact.phone_number, userId: contact.user_id };
}

/**
 * Проверяет данные Telegram Login Widget (вход в обычном браузере): пересчитывает
 * HMAC-подпись с секретом `SHA256(bot_token)`, сверяет `hash`, проверяет `auth_date`.
 */
export async function validateWidgetLogin(
  data: WidgetLoginInput,
  botToken: string
): Promise<TelegramUser> {
  const entries: [string, string][] = [];
  for (const [key, value] of Object.entries(data)) {
    if (key === "hash" || value === undefined) continue;
    entries.push([key, String(value)]);
  }
  const dataCheckString = buildDataCheckString(entries);

  // secret_key = SHA256(bot_token)
  const secretKey = await sha256(botToken);
  const computed = toHex(await hmacSha256(secretKey, dataCheckString));

  if (!timingSafeEqual(computed, data.hash)) {
    throw new HttpError(401, "Не удалось подтвердить вход через Telegram");
  }

  assertFresh(data.auth_date, WIDGET_MAX_AUTH_AGE_SEC);
  if (!isPlausibleTelegramId(data.id)) {
    throw new HttpError(401, "Некорректный идентификатор Telegram");
  }

  return {
    id: data.id,
    username: data.username ?? null,
    firstName: data.first_name ?? null,
    lastName: data.last_name ?? null
  };
}
