import { TELEGRAM_BOT_TOKEN } from "./helpers/env";
import { loginAsTelegramUser } from "./helpers/telegramAuth";
import { api, E2E_PREFIX } from "./helpers/api";
import { TEST_ADMIN, TEST_USER } from "./data/testUsers";

/** Строгая зачистка данных текущего E2E-run; ошибка не должна исчезать бесследно. */
export default async function globalTeardown() {
  const { token } = await loginAsTelegramUser(
    process.env.E2E_API_URL ?? "http://127.0.0.1:3000",
    TELEGRAM_BOT_TOKEN,
    TEST_ADMIN,
  );
  const failures: unknown[] = [];
  try {
    const { token: userToken } = await loginAsTelegramUser(
      process.env.E2E_API_URL ?? "http://127.0.0.1:3000",
      TELEGRAM_BOT_TOKEN,
      TEST_USER,
    );
    await api.post("/profile/register", userToken, {
      contactName: `${E2E_PREFIX} Тестовый пользователь`,
      contactPhone: "+77010000001",
    });
  } catch (error) {
    failures.push(error);
  }
  try {
    await api.post("/admin/e2e/cleanup", token);
  } catch (error) {
    failures.push(error);
  }
  if (failures.length > 0) {
    throw new AggregateError(failures, `E2E teardown failed for ${failures.length} step(s)`);
  }
}
