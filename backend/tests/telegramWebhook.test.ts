import { afterEach, describe, expect, test } from "bun:test";
import { createApp } from "../src/app";
import type { AppEnv } from "../src/env";
import { classifyUpdate } from "../src/lib/telegramWebhook";

const ADMIN_ID = 111;
const admins = new Set([ADMIN_ID]);
const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

/** my_chat_member: бот появился/исчез в групповом чате. */
function memberUpdate(opts: { fromId: number; oldStatus: string; newStatus: string; chatType?: string }) {
  return {
    my_chat_member: {
      chat: { id: -100500, type: opts.chatType ?? "group" },
      from: { id: opts.fromId },
      old_chat_member: { status: opts.oldStatus },
      new_chat_member: { status: opts.newStatus }
    }
  };
}

describe("classifyUpdate", () => {
  test("бот добавлен админом в группу → save_chat", () => {
    const action = classifyUpdate(memberUpdate({ fromId: ADMIN_ID, oldStatus: "left", newStatus: "member" }), admins);
    expect(action).toEqual({ type: "save_chat", chatId: -100500 });
  });

  test("бот добавлен админом сразу администратором чата → save_chat", () => {
    const action = classifyUpdate(
      memberUpdate({ fromId: ADMIN_ID, oldStatus: "left", newStatus: "administrator", chatType: "supergroup" }),
      admins
    );
    expect(action).toEqual({ type: "save_chat", chatId: -100500 });
  });

  test("бот добавлен не-админом → ignore", () => {
    const action = classifyUpdate(memberUpdate({ fromId: 999, oldStatus: "left", newStatus: "member" }), admins);
    expect(action).toEqual({ type: "ignore" });
  });

  test("бот удалён из группы (kicked) → clear_chat", () => {
    const action = classifyUpdate(memberUpdate({ fromId: 999, oldStatus: "member", newStatus: "kicked" }), admins);
    expect(action).toEqual({ type: "clear_chat", chatId: -100500 });
  });

  test("бот вышел из группы (left) → clear_chat", () => {
    const action = classifyUpdate(memberUpdate({ fromId: ADMIN_ID, oldStatus: "member", newStatus: "left" }), admins);
    expect(action).toEqual({ type: "clear_chat", chatId: -100500 });
  });

  test("апгрейд группы до супергруппы → migrate_chat", () => {
    const action = classifyUpdate(
      { message: { chat: { id: -100500, type: "group" }, migrate_to_chat_id: -1009999 } },
      admins
    );
    expect(action).toEqual({ type: "migrate_chat", fromChatId: -100500, toChatId: -1009999 });
  });

  test("/start в личном чате → greet", () => {
    const action = classifyUpdate({ message: { chat: { id: 777, type: "private" }, text: "/start" } }, admins);
    expect(action).toEqual({ type: "greet", chatId: 777 });
  });

  test("обычное личное сообщение → ignore", () => {
    const action = classifyUpdate({ message: { chat: { id: 777, type: "private" }, text: "привет" } }, admins);
    expect(action).toEqual({ type: "ignore" });
  });

  test("групповое сообщение → ignore", () => {
    const action = classifyUpdate({ message: { chat: { id: -1, type: "group" }, text: "привет" } }, admins);
    expect(action).toEqual({ type: "ignore" });
  });

  test("null и мусор → ignore", () => {
    expect(classifyUpdate(null, admins)).toEqual({ type: "ignore" });
    expect(classifyUpdate("garbage", admins)).toEqual({ type: "ignore" });
    expect(classifyUpdate({ unknown_field: 1 }, admins)).toEqual({ type: "ignore" });
  });

  test("событие в канале → ignore", () => {
    const action = classifyUpdate(
      memberUpdate({ fromId: ADMIN_ID, oldStatus: "left", newStatus: "administrator", chatType: "channel" }),
      admins
    );
    expect(action).toEqual({ type: "ignore" });
  });
});

describe("POST /telegram/webhook (секрет)", () => {
  const env: Partial<AppEnv> = {
    TELEGRAM_WEBHOOK_SECRET: "test-secret",
    TELEGRAM_BOT_TOKEN: "test-token",
    ADMIN_ALLOWLIST: String(ADMIN_ID),
    WEBAPP_ORIGIN: "https://agromarket.example"
  };

  function post(body: unknown, secret?: string) {
    const app = createApp({ env });
    return app.request("/telegram/webhook", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(secret ? { "X-Telegram-Bot-Api-Secret-Token": secret } : {})
      },
      body: JSON.stringify(body)
    });
  }

  test("без секрета → 401", async () => {
    const res = await post({});
    expect(res.status).toBe(401);
  });

  test("с неверным секретом → 401", async () => {
    const res = await post({}, "wrong-secret");
    expect(res.status).toBe(401);
  });

  test("секрет не настроен на сервере → 401", async () => {
    const app = createApp({ env: { ADMIN_ALLOWLIST: "" } });
    const res = await app.request("/telegram/webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Telegram-Bot-Api-Secret-Token": "anything" },
      body: "{}"
    });
    expect(res.status).toBe(401);
  });

  test("верный секрет и ignore-апдейт → 200 ok", async () => {
    const res = await post({ unknown_field: 1 }, "test-secret");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  test("/start отправляет приветственное фото с инструкцией", async () => {
    let requestedUrl = "";
    let body: Record<string, unknown> | null = null;
    globalThis.fetch = (async (input, init) => {
      requestedUrl = String(input);
      body = JSON.parse(String(init?.body));
      return new Response("{}", { status: 200 });
    }) as typeof fetch;

    const res = await post({ message: { chat: { id: 777, type: "private" }, text: "/start" } }, "test-secret");

    expect(res.status).toBe(200);
    expect(requestedUrl).toBe("https://api.telegram.org/bottest-token/sendPhoto");
    expect(body).toEqual({
      chat_id: "777",
      photo: "https://agromarket.example/welcome-banner.png",
      caption: expect.stringContaining("Добро пожаловать в AgroMarketKZ"),
      parse_mode: "HTML"
    });
  });

  test("верный секрет и невалидный JSON → 200 ok (Telegram не ретраит)", async () => {
    const app = createApp({ env });
    const res = await app.request("/telegram/webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Telegram-Bot-Api-Secret-Token": "test-secret" },
      body: "not-json"
    });
    expect(res.status).toBe(200);
  });
});
