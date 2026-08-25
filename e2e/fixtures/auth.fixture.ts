import { test as base, type Page } from "@playwright/test";
import { api, E2E_PREFIX } from "../helpers/api";
import { API_URL, BASE_URL, TELEGRAM_BOT_TOKEN } from "../helpers/env";
import { loginAsTelegramUser } from "../helpers/telegramAuth";
import { telegramIdFor } from "../helpers/telegramIdentity";
import { TEST_ADMIN, TEST_USER } from "../data/testUsers";

interface AuthFixtures {
  userSession: string;
  adminSession: string;
  /** Авторизованная страница обычного пользователя с уже заполненным профилем. */
  userPage: Page;
  /** Авторизованная страница администратора с уже заполненным профилем. */
  adminPage: Page;
  /** Как userPage, но БЕЗ регистрации — для сценария первого входа. */
  unregisteredUserPage: Page;
  /**
   * Свежий (случайный) telegram id на каждый тест — не делит rate-limit заявок (5/10 мин)
   * с общим TEST_USER, которого используют другие спеки.
   */
  freshUserPage: Page;
}

async function injectSession(page: Page, sessionCookie: string) {
  const separator = sessionCookie.indexOf("=");
  if (separator <= 0) {
    throw new Error("Cannot inject invalid E2E session cookie");
  }
  await page.context().addCookies([{
    name: sessionCookie.slice(0, separator),
    value: sessionCookie.slice(separator + 1),
    url: API_URL,
    httpOnly: true,
    sameSite: "Strict",
  }]);
}

export const test = base.extend<AuthFixtures>({
  userSession: async ({}, use) => {
    const { cookie } = await loginAsTelegramUser(API_URL, TELEGRAM_BOT_TOKEN, TEST_USER);
    await use(cookie);
  },
  adminSession: async ({}, use) => {
    const { cookie } = await loginAsTelegramUser(API_URL, TELEGRAM_BOT_TOKEN, TEST_ADMIN);
    await api.post("/profile/register", cookie, { contactName: `${E2E_PREFIX} Тестовый админ`, contactPhone: "+77010000002" });
    await use(cookie);
  },
  unregisteredUserPage: async ({ browser }, use, testInfo) => {
    const freshUser = {
      id: telegramIdFor(process.env.E2E_RUN_ID ?? "", `fixture:anonymous:${testInfo.testId}`),
      first_name: `${E2E_PREFIX} Guest`,
      last_name: "Guest",
    };
    const { cookie } = await loginAsTelegramUser(
      API_URL,
      TELEGRAM_BOT_TOKEN,
      freshUser,
    );
    const context = await browser.newContext();
    const page = await context.newPage();
    await injectSession(page, cookie);
    await page.goto(BASE_URL);
    try {
      await use(page);
    } finally {
      await context.close();
      // Даже если сценарий упал до регистрации, маркируем созданную auth-строку.
      // Cleanup удалит её по telegram_first_name и не оставит случайный user orphan.
      await api.post("/profile/register", cookie, {
        contactName: `${E2E_PREFIX} Незарегистрированный гость`,
        contactPhone: "+77010000004",
      });
    }
  },
  userPage: async ({ browser, userSession }, use) => {
    await api.post("/profile/register", userSession, { contactName: `${E2E_PREFIX} Тестовый пользователь`, contactPhone: "+77010000001" });
    const context = await browser.newContext();
    const page = await context.newPage();
    await injectSession(page, userSession);
    await page.goto(BASE_URL);
    await use(page);
    await context.close();
  },
  adminPage: async ({ browser, adminSession }, use) => {
    await api.post("/profile/register", adminSession, { contactName: `${E2E_PREFIX} Тестовый админ`, contactPhone: "+77010000002" });
    const context = await browser.newContext();
    const page = await context.newPage();
    await injectSession(page, adminSession);
    await page.goto(BASE_URL);
    await use(page);
    await context.close();
  },
  freshUserPage: async ({ browser }, use, testInfo) => {
    const freshUser = {
      id: telegramIdFor(process.env.E2E_RUN_ID ?? "", `fixture:fresh-user:${testInfo.testId}`),
      first_name: `${E2E_PREFIX} Fresh`,
      last_name: "Fresh"
    };
    const { cookie } = await loginAsTelegramUser(
      API_URL,
      TELEGRAM_BOT_TOKEN,
      freshUser
    );
    await api.post("/profile/register", cookie, { contactName: `${E2E_PREFIX} Свежий пользователь`, contactPhone: "+77010000003" });
    const context = await browser.newContext();
    const page = await context.newPage();
    await injectSession(page, cookie);
    await page.goto(BASE_URL);
    await use(page);
    await context.close();
  }
});

export { expect } from "@playwright/test";
