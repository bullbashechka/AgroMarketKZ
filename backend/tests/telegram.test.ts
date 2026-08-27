import { describe, expect, test } from "bun:test";
import type { WidgetLoginInput } from "@agromarket/contracts";
import {
  telegramIdentityHash,
  validateContactResponse,
  validateInitData,
  validateWidgetLogin,
} from "../src/lib/telegram";
import { validateContactPhoneForUser } from "../src/lib/contact";

const BOT_TOKEN = "123456:TEST-BOT-TOKEN";
const encoder = new TextEncoder();

async function hmac(keyBytes: ArrayBuffer | Uint8Array, message: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(message)));
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function dataCheckString(entries: [string, string][]): string {
  return entries
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
}

/** Собирает валидную строку initData Mini App с правильной подписью. */
async function buildInitData(authDate: number): Promise<string> {
  const user = JSON.stringify({ id: 777, first_name: "Aidos", username: "aidos" });
  const entries: [string, string][] = [
    ["auth_date", String(authDate)],
    ["query_id", "AAEXAMPLE"],
    ["user", user]
  ];
  const secret = await hmac(encoder.encode("WebAppData"), BOT_TOKEN);
  const hash = hex(await hmac(secret, dataCheckString(entries)));
  const params = new URLSearchParams(entries);
  params.set("hash", hash);
  return params.toString();
}

/** Собирает валидные данные Login Widget с правильной подписью. */
async function buildWidget(authDate: number): Promise<WidgetLoginInput> {
  const fields: [string, string][] = [
    ["auth_date", String(authDate)],
    ["first_name", "Aidos"],
    ["id", "777"],
    ["username", "aidos"]
  ];
  const secret = await crypto.subtle.digest("SHA-256", encoder.encode(BOT_TOKEN));
  const hash = hex(await hmac(secret, dataCheckString(fields)));
  return { id: 777, first_name: "Aidos", username: "aidos", auth_date: authDate, hash };
}

const now = () => Math.floor(Date.now() / 1000);

describe("validateInitData", () => {
  test("принимает валидную подпись и возвращает пользователя", async () => {
    const authDate = now();
    const initData = await buildInitData(authDate);
    const result = await validateInitData(initData, BOT_TOKEN);
    expect(result).toEqual({
      user: { id: 777, username: "aidos", firstName: "Aidos", lastName: null },
      authDate,
    });
  });

  test("отклоняет подделанную подпись", async () => {
    const initData = await buildInitData(now());
    const tampered = initData.replace(/hash=[0-9a-f]+/, "hash=deadbeef");
    await expect(validateInitData(tampered, BOT_TOKEN)).rejects.toThrow();
  });

  test("отклоняет чужой токен бота", async () => {
    const initData = await buildInitData(now());
    await expect(validateInitData(initData, "999:OTHER")).rejects.toThrow();
  });

  test("отклоняет устаревший auth_date (>24ч)", async () => {
    const initData = await buildInitData(now() - 25 * 60 * 60);
    await expect(validateInitData(initData, BOT_TOKEN)).rejects.toThrow();
  });

  test("отклоняет auth_date из далёкого будущего", async () => {
    const initData = await buildInitData(now() + 31);
    await expect(validateInitData(initData, BOT_TOKEN)).rejects.toThrow();
  });
});

describe("telegramIdentityHash", () => {
  test("не раскрывает Telegram id и стабилен для одного bot token", async () => {
    const first = await telegramIdentityHash(777, BOT_TOKEN);
    const second = await telegramIdentityHash(777, BOT_TOKEN);

    expect(first).toHaveLength(64);
    expect(first).toBe(second);
    expect(first).not.toContain("777");
    expect(await telegramIdentityHash(778, BOT_TOKEN)).not.toBe(first);
    expect(await telegramIdentityHash(777, "999:OTHER")).not.toBe(first);
  });
});

/** Собирает валидную подписанную строку ответа requestContact. */
async function buildContactResponse(
  authDate: number,
  contact: Record<string, unknown> | null = { phone_number: "77011234567", user_id: 777, first_name: "Aidos" }
): Promise<string> {
  const entries: [string, string][] = [["auth_date", String(authDate)]];
  if (contact) entries.push(["contact", JSON.stringify(contact)]);
  const secret = await hmac(encoder.encode("WebAppData"), BOT_TOKEN);
  const hash = hex(await hmac(secret, dataCheckString(entries)));
  const params = new URLSearchParams(entries);
  params.set("hash", hash);
  return params.toString();
}

describe("validateContactResponse", () => {
  test("принимает валидную подпись и возвращает телефон с user_id", async () => {
    const response = await buildContactResponse(now());
    const contact = await validateContactResponse(response, BOT_TOKEN);
    expect(contact).toEqual({ phoneNumber: "77011234567", userId: 777 });
  });

  test("отклоняет подделанную подпись", async () => {
    const response = await buildContactResponse(now());
    const tampered = response.replace(/hash=[0-9a-f]+/, "hash=deadbeef");
    await expect(validateContactResponse(tampered, BOT_TOKEN)).rejects.toThrow();
  });

  test("отклоняет чужой токен бота", async () => {
    const response = await buildContactResponse(now());
    await expect(validateContactResponse(response, "999:OTHER")).rejects.toThrow();
  });

  test("отклоняет устаревший auth_date (>10 мин)", async () => {
    const response = await buildContactResponse(now() - 11 * 60);
    await expect(validateContactResponse(response, BOT_TOKEN)).rejects.toThrow();
  });

  test("отклоняет auth_date из далёкого будущего", async () => {
    const response = await buildContactResponse(now() + 31);
    await expect(validateContactResponse(response, BOT_TOKEN)).rejects.toThrow();
  });

  test("отклоняет payload без contact", async () => {
    const response = await buildContactResponse(now(), null);
    await expect(validateContactResponse(response, BOT_TOKEN)).rejects.toThrow();
  });

  test("отклоняет contact без телефона или user_id", async () => {
    const response = await buildContactResponse(now(), { first_name: "Aidos" });
    await expect(validateContactResponse(response, BOT_TOKEN)).rejects.toThrow();
  });

  test("отклоняет contact с нечисловым или синтетически невозможным user_id", async () => {
    const response = await buildContactResponse(now(), { phone_number: "77011234567", user_id: "777" });
    await expect(validateContactResponse(response, BOT_TOKEN)).rejects.toThrow();
  });
});

describe("validateContactPhoneForUser", () => {
  test("нормализует только proof текущего Telegram пользователя", async () => {
    const response = await buildContactResponse(now());
    await expect(validateContactPhoneForUser(response, 777, { TELEGRAM_BOT_TOKEN: BOT_TOKEN } as never))
      .resolves.toBe("+77011234567");
    await expect(validateContactPhoneForUser(response, 778, { TELEGRAM_BOT_TOKEN: BOT_TOKEN } as never))
      .rejects.toThrow("другому пользователю");
  });
});

describe("validateWidgetLogin", () => {
  test("принимает валидную подпись виджета", async () => {
    const data = await buildWidget(now());
    const user = await validateWidgetLogin(data, BOT_TOKEN);
    expect(user).toEqual({ id: 777, username: "aidos", firstName: "Aidos", lastName: null });
  });

  test("отклоняет подделанный hash", async () => {
    const data = await buildWidget(now());
    await expect(validateWidgetLogin({ ...data, hash: "deadbeef" }, BOT_TOKEN)).rejects.toThrow();
  });

  test("отклоняет устаревший auth_date", async () => {
    const data = await buildWidget(now() - 25 * 60 * 60);
    await expect(validateWidgetLogin(data, BOT_TOKEN)).rejects.toThrow();
  });

  test("отклоняет Widget proof старше пяти минут", async () => {
    const data = await buildWidget(now() - 6 * 60);
    await expect(validateWidgetLogin(data, BOT_TOKEN)).rejects.toThrow();
  });

  test("отклоняет Widget auth_date из будущего", async () => {
    const data = await buildWidget(now() + 5);
    await expect(validateWidgetLogin(data, BOT_TOKEN)).rejects.toThrow();
  });
});
