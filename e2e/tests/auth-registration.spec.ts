import { test, expect } from "@playwright/test";
import { BASE_URL, TELEGRAM_BOT_TOKEN } from "../helpers/env";
import { loginAsTelegramUser } from "../helpers/telegramAuth";

test("регистрация при первом входе: имя + телефон", async ({ browser }) => {
  // Свежий telegram id на каждый прогон — гарантированно незарегистрированный пользователь.
  const freshUser = { id: Math.floor(900_100_000 + Math.random() * 100_000), first_name: "E2E", last_name: "Fresh" };
  const { token } = await loginAsTelegramUser(process.env.E2E_API_URL ?? "http://localhost:3000", TELEGRAM_BOT_TOKEN, freshUser);

  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(BASE_URL);
  await page.evaluate((t) => window.localStorage.setItem("agromarket.jwt", t), token);
  await page.reload();

  await expect(page.getByTestId("register-name-input")).toBeVisible({ timeout: 15_000 });
  await page.getByTestId("register-name-input").fill("Айдос Тестов");
  await page.getByTestId("register-phone-input").fill("+77011234567");
  await page.getByTestId("register-submit").click();

  await expect(page.getByTestId("tab-services")).toBeVisible({ timeout: 15_000 });

  await context.close();
});
