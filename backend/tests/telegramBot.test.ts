import { afterEach, describe, expect, test } from "bun:test";
import type { AppEnv } from "../src/env";
import {
  buildRequestDeepLink,
  escapeHtml,
  formatFeedbackNotification,
  formatRequestNotification,
  sendAdminNotification,
  sendTelegramPhoto
} from "../src/lib/telegramBot";

describe("escapeHtml", () => {
  test("экранирует &, < и >", () => {
    expect(escapeHtml("Тест <b>&</b>")).toBe("Тест &lt;b&gt;&amp;&lt;/b&gt;");
  });
});

describe("formatRequestNotification", () => {
  test("заявка из карточки с фиксированной ценой", () => {
    const html = formatRequestNotification({
      source: "card",
      tabType: null,
      cardTitleSnapshot: "Пшеница <1 сорт>",
      cardPriceTypeSnapshot: "fixed",
      cardPriceAmountSnapshot: 120000,
      contactName: "Айбек",
      contactPhone: "+77011234567",
      contactPhoneVerified: false,
      comment: "Нужно 5 тонн",
      telegramUsername: "aibek"
    });
    expect(html).toContain("Источник: Из карточки");
    expect(html).toContain("Карточка: Пшеница &lt;1 сорт&gt;");
    expect(html).toContain("Цена: " + (120000).toLocaleString("ru-RU") + " ₸");
    expect(html).toContain("Telegram: @aibek");
    expect(html).toContain("Комментарий: Нужно 5 тонн");
  });

  test("заявка из карточки с ценой по запросу", () => {
    const html = formatRequestNotification({
      source: "card",
      tabType: null,
      cardTitleSnapshot: "Трактор",
      cardPriceTypeSnapshot: "on_request",
      cardPriceAmountSnapshot: null,
      contactName: "Айбек",
      contactPhone: "+77011234567",
      contactPhoneVerified: false,
      comment: null,
      telegramUsername: null
    });
    expect(html).toContain("Цена: Цена по запросу");
    expect(html).not.toContain("Комментарий");
    expect(html).not.toContain("Telegram:");
  });

  test("заявка с вкладки указывает тип вкладки", () => {
    const html = formatRequestNotification({
      source: "tab",
      tabType: "service",
      cardTitleSnapshot: null,
      cardPriceTypeSnapshot: null,
      cardPriceAmountSnapshot: null,
      contactName: "Айбек",
      contactPhone: "+77011234567",
      contactPhoneVerified: false,
      comment: null,
      telegramUsername: null
    });
    expect(html).toContain("Вкладка: Услуги");
  });

  test("заявка из профиля не содержит карточку/вкладку", () => {
    const html = formatRequestNotification({
      source: "profile",
      tabType: null,
      cardTitleSnapshot: null,
      cardPriceTypeSnapshot: null,
      cardPriceAmountSnapshot: null,
      contactName: "Айбек",
      contactPhone: "+77011234567",
      contactPhoneVerified: false,
      comment: null,
      telegramUsername: null
    });
    expect(html).not.toContain("Карточка:");
    expect(html).not.toContain("Вкладка:");
  });
});

describe("отметка подтверждённого телефона", () => {
  test("подтверждённый номер помечается в заявке", () => {
    const html = formatRequestNotification({
      source: "profile",
      tabType: null,
      cardTitleSnapshot: null,
      cardPriceTypeSnapshot: null,
      cardPriceAmountSnapshot: null,
      contactName: "Айбек",
      contactPhone: "+77011234567",
      contactPhoneVerified: true,
      comment: null,
      telegramUsername: null
    });
    expect(html).toContain("Телефон: +77011234567 ✓ подтверждён через Telegram");
  });

  test("неподтверждённый номер — без отметки", () => {
    const html = formatFeedbackNotification({
      contactName: "Айбек",
      contactPhone: "+77011234567",
      contactPhoneVerified: false,
      message: "Вопрос",
      telegramUsername: null
    });
    expect(html).toContain("Телефон: +77011234567\n");
    expect(html).not.toContain("подтверждён");
  });
});

describe("buildRequestDeepLink", () => {
  const baseEnv = {} as AppEnv;

  test("собирает t.me-ссылку c startapp при заданном env", () => {
    const env = {
      ...baseEnv,
      TELEGRAM_BOT_USERNAME: "agromarket_bot",
      TELEGRAM_MINIAPP_SHORTNAME: "market"
    } as AppEnv;
    expect(buildRequestDeepLink(env, "abc-123")).toBe(
      "https://t.me/agromarket_bot/market?startapp=request_abc-123"
    );
  });

  test("возвращает null без username/shortname", () => {
    expect(buildRequestDeepLink(baseEnv, "abc")).toBeNull();
    expect(
      buildRequestDeepLink({ ...baseEnv, TELEGRAM_BOT_USERNAME: "bot" } as AppEnv, "abc")
    ).toBeNull();
  });
});

describe("sendAdminNotification (ретрай)", () => {
  const realFetch = globalThis.fetch;
  const env = { TELEGRAM_BOT_TOKEN: "123:TEST" } as AppEnv;

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  test("успех с первой попытки — один запрос", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return new Response("{}", { status: 200 });
    }) as typeof fetch;

    await sendAdminNotification(env, "-100", "test");
    expect(calls).toBe(1);
  });

  test("после неудачи выполняется ровно одна повторная попытка", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return new Response("error", { status: 500 });
    }) as typeof fetch;

    await sendAdminNotification(env, "-100", "test");
    expect(calls).toBe(2);
  });

  test("сетевая ошибка не пробрасывается наружу", async () => {
    globalThis.fetch = (async () => {
      throw new Error("network down");
    }) as typeof fetch;

    await expect(sendAdminNotification(env, "-100", "test")).resolves.toBeUndefined();
  });
});

describe("sendTelegramPhoto", () => {
  const realFetch = globalThis.fetch;
  const env = { TELEGRAM_BOT_TOKEN: "123:TEST" } as AppEnv;

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  test("отправляет фото с HTML-подписью и кнопкой", async () => {
    let requestedUrl = "";
    let body: Record<string, unknown> | null = null;
    globalThis.fetch = (async (input, init) => {
      requestedUrl = String(input);
      body = JSON.parse(String(init?.body));
      return new Response("{}", { status: 200 });
    }) as typeof fetch;

    const replyMarkup = { inline_keyboard: [[{ text: "Открыть", url: "https://t.me/agromarket" }]] };
    await expect(
      sendTelegramPhoto(env, "777", "https://agromarket.example/welcome-banner.png", "<b>Добро пожаловать</b>", replyMarkup)
    ).resolves.toBeTrue();

    expect(requestedUrl).toBe("https://api.telegram.org/bot123:TEST/sendPhoto");
    expect(body).toEqual({
      chat_id: "777",
      photo: "https://agromarket.example/welcome-banner.png",
      caption: "<b>Добро пожаловать</b>",
      parse_mode: "HTML",
      reply_markup: replyMarkup
    });
  });
});

describe("formatFeedbackNotification", () => {
  test("формирует сообщение с экранированием", () => {
    const html = formatFeedbackNotification({
      contactName: "Айбек",
      contactPhone: "+77011234567",
      contactPhoneVerified: false,
      message: "Вопрос <срочно>",
      telegramUsername: null
    });
    expect(html).toContain("Сообщение: Вопрос &lt;срочно&gt;");
    expect(html).not.toContain("Telegram:");
  });
});
