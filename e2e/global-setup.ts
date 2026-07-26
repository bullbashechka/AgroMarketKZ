import { TEST_ADMIN } from "./data/testUsers";
import { api } from "./helpers/api";
import { API_URL, TELEGRAM_BOT_TOKEN } from "./helpers/env";
import { loginAsTelegramUser } from "./helpers/telegramAuth";

export default async function globalSetup() {
  const { token } = await loginAsTelegramUser(API_URL, TELEGRAM_BOT_TOKEN, TEST_ADMIN);
  const profile = await api.get<{ isAdmin: boolean }>("/profile", token);

  if (!profile.isAdmin) {
    throw new Error(
      "E2E admin guard failed: TEST_ADMIN is not an admin. Stop an existing dev backend and verify .env.e2e ADMIN_ALLOWLIST."
    );
  }
}
