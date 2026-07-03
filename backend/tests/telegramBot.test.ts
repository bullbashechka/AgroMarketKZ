import { describe, expect, test } from "bun:test";
import { escapeHtml, formatFeedbackNotification, formatRequestNotification } from "../src/lib/telegramBot";

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
      comment: null,
      telegramUsername: null
    });
    expect(html).not.toContain("Карточка:");
    expect(html).not.toContain("Вкладка:");
  });
});

describe("formatFeedbackNotification", () => {
  test("формирует сообщение с экранированием", () => {
    const html = formatFeedbackNotification({
      contactName: "Айбек",
      contactPhone: "+77011234567",
      message: "Вопрос <срочно>",
      telegramUsername: null
    });
    expect(html).toContain("Сообщение: Вопрос &lt;срочно&gt;");
    expect(html).not.toContain("Telegram:");
  });
});
