import { TELEGRAM_BOT_TOKEN } from "./helpers/env";
import { loginAsTelegramUser } from "./helpers/telegramAuth";
import { sweepE2eLeftovers } from "./helpers/api";
import { TEST_ADMIN } from "./data/testUsers";

/** Best-effort зачистка [e2e]-карточек/категорий, оставшихся после упавшего теста. */
export default async function globalTeardown() {
  try {
    const { token } = await loginAsTelegramUser(
      process.env.E2E_API_URL ?? "http://localhost:3000",
      TELEGRAM_BOT_TOKEN,
      TEST_ADMIN
    );
    await sweepE2eLeftovers(token);
  } catch {
    // best-effort — не проваливаем прогон из-за зачистки
  }
}
