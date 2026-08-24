import { test as base, type Page } from "@playwright/test";
import { api, E2E_PREFIX } from "../helpers/api";
import { BASE_URL, TELEGRAM_BOT_TOKEN } from "../helpers/env";
import { loginAsTelegramUser } from "../helpers/telegramAuth";
import { telegramIdFor } from "../helpers/telegramIdentity";
import { TEST_ADMIN, TEST_USER } from "../data/testUsers";

interface AuthFixtures {
  userToken: string;
  adminToken: string;
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

async function injectSession(page: Page, token: string) {
  await page.goto(BASE_URL);
  await page.evaluate((t) => window.localStorage.setItem("agromarket.jwt", t), token);
}

export const test = base.extend<AuthFixtures>({
  userToken: async ({}, use) => {
    const { token } = await loginAsTelegramUser(process.env.E2E_API_URL ?? "http://localhost:3000", TELEGRAM_BOT_TOKEN, TEST_USER);
    await use(token);
  },
  adminToken: async ({}, use) => {
    const { token } = await loginAsTelegramUser(process.env.E2E_API_URL ?? "http://localhost:3000", TELEGRAM_BOT_TOKEN, TEST_ADMIN);
    await api.post("/profile/register", token, { contactName: `${E2E_PREFIX} Тестовый админ`, contactPhone: "+77010000002" });
    await use(token);
  },
  unregisteredUserPage: async ({ browser }, use, testInfo) => {
    const freshUser = {
      id: telegramIdFor(process.env.E2E_RUN_ID ?? "", `fixture:anonymous:${testInfo.testId}`),
      first_name: `${E2E_PREFIX} Guest`,
      last_name: "Guest",
    };
    const { token } = await loginAsTelegramUser(
      process.env.E2E_API_URL ?? "http://localhost:3000",
      TELEGRAM_BOT_TOKEN,
      freshUser,
    );
    const context = await browser.newContext();
    const page = await context.newPage();
    await injectSession(page, token);
    await page.reload();
    try {
      await use(page);
    } finally {
      await context.close();
      // Даже если сценарий упал до регистрации, маркируем созданную auth-строку.
      // Cleanup удалит её по telegram_first_name и не оставит случайный user orphan.
      await api.post("/profile/register", token, {
        contactName: `${E2E_PREFIX} Незарегистрированный гость`,
        contactPhone: "+77010000004",
      });
    }
  },
  userPage: async ({ browser, userToken }, use) => {
    await api.post("/profile/register", userToken, { contactName: `${E2E_PREFIX} Тестовый пользователь`, contactPhone: "+77010000001" });
    const context = await browser.newContext();
    const page = await context.newPage();
    await injectSession(page, userToken);
    await page.reload();
    await use(page);
    await context.close();
  },
  adminPage: async ({ browser, adminToken }, use) => {
    await api.post("/profile/register", adminToken, { contactName: `${E2E_PREFIX} Тестовый админ`, contactPhone: "+77010000002" });
    const context = await browser.newContext();
    const page = await context.newPage();
    await injectSession(page, adminToken);
    await page.reload();
    await use(page);
    await context.close();
  },
  freshUserPage: async ({ browser }, use, testInfo) => {
    const freshUser = {
      id: telegramIdFor(process.env.E2E_RUN_ID ?? "", `fixture:fresh-user:${testInfo.testId}`),
      first_name: `${E2E_PREFIX} Fresh`,
      last_name: "Fresh"
    };
    const { token } = await loginAsTelegramUser(
      process.env.E2E_API_URL ?? "http://localhost:3000",
      TELEGRAM_BOT_TOKEN,
      freshUser
    );
    await api.post("/profile/register", token, { contactName: `${E2E_PREFIX} Свежий пользователь`, contactPhone: "+77010000003" });
    const context = await browser.newContext();
    const page = await context.newPage();
    await injectSession(page, token);
    await page.reload();
    await use(page);
    await context.close();
  }
});

export { expect } from "@playwright/test";
