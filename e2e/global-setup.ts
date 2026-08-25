import { TEST_ADMIN } from "./data/testUsers";
import { api, E2E_PREFIX } from "./helpers/api";
import { API_URL, TELEGRAM_BOT_TOKEN } from "./helpers/env";
import { loginAsTelegramUser } from "./helpers/telegramAuth";

export default async function globalSetup() {
  const { cookie } = await loginAsTelegramUser(API_URL, TELEGRAM_BOT_TOKEN, TEST_ADMIN);
  const profile = await api.get<{ isAdmin: boolean }>("/profile", cookie);

  if (!profile.isAdmin) {
    throw new Error(
      "E2E admin guard failed: generated TEST_ADMIN is not an admin. Stop an existing dev backend and verify the isolated E2E backend environment."
    );
  }

  // Глобальный login создаёт строку users даже если ни один тест не запросит adminSession.
  // Помечаем её, чтобы test-only cleanup мог удалить только данные этого run.
  await api.post("/profile/register", cookie, {
    contactName: `${E2E_PREFIX} Тестовый админ`,
    contactPhone: "+77010000002",
  });
}
