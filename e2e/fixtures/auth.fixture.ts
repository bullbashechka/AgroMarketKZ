import { test as base, type Page } from "@playwright/test";
import { api } from "../helpers/api";
import { BASE_URL, TELEGRAM_BOT_TOKEN } from "../helpers/env";
import { loginAsTelegramUser } from "../helpers/telegramAuth";
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
    await use(token);
  },
  unregisteredUserPage: async ({ browser }, use) => {
    const freshUser = {
      id: Math.floor(999_100_000_000 + Math.random() * 100_000_000),
      first_name: "E2E",
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
    await use(page);
    await context.close();
  },
  userPage: async ({ browser, userToken }, use) => {
    await api.post("/profile/register", userToken, { contactName: "E2E Тестовый пользователь", contactPhone: "+77010000001" });
    const context = await browser.newContext();
    const page = await context.newPage();
    await injectSession(page, userToken);
    await page.reload();
    await use(page);
    await context.close();
  },
  adminPage: async ({ browser, adminToken }, use) => {
    await api.post("/profile/register", adminToken, { contactName: "E2E Тестовый админ", contactPhone: "+77010000002" });
    const context = await browser.newContext();
    const page = await context.newPage();
    await injectSession(page, adminToken);
    await page.reload();
    await use(page);
    await context.close();
  },
  freshUserPage: async ({ browser }, use) => {
    const freshUser = {
      id: Math.floor(999_200_000_000 + Math.random() * 100_000_000),
      first_name: "E2E",
      last_name: "Fresh"
    };
    const { token } = await loginAsTelegramUser(
      process.env.E2E_API_URL ?? "http://localhost:3000",
      TELEGRAM_BOT_TOKEN,
      freshUser
    );
    await api.post("/profile/register", token, { contactName: "E2E Свежий пользователь", contactPhone: "+77010000003" });
    const context = await browser.newContext();
    const page = await context.newPage();
    await injectSession(page, token);
    await page.reload();
    await use(page);
    await context.close();
  }
});

export { expect } from "@playwright/test";
