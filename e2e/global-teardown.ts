import type { AppEnv } from "../backend/src/env";
import { closeDb } from "../backend/src/db";
import { cleanupE2eRun } from "../backend/src/repos/e2eCleanup";
import { API_URL, requireEnv, TELEGRAM_BOT_TOKEN } from "./helpers/env";
import { loginAsTelegramUser } from "./helpers/telegramAuth";
import { api, E2E_PREFIX } from "./helpers/api";
import { TEST_USER } from "./data/testUsers";

const cleanupEnv = {
  DATABASE_URL: requireEnv("E2E_DATABASE_URL"),
  SUPABASE_URL: requireEnv("E2E_SUPABASE_URL"),
  SUPABASE_STORAGE_BUCKET: requireEnv("E2E_SUPABASE_STORAGE_BUCKET"),
  SUPABASE_SERVICE_ROLE_KEY: requireEnv("E2E_SUPABASE_SERVICE_ROLE_KEY"),
  E2E_RUN_ID: requireEnv("E2E_RUN_ID"),
} satisfies Pick<
  AppEnv,
  | "DATABASE_URL"
  | "SUPABASE_URL"
  | "SUPABASE_STORAGE_BUCKET"
  | "SUPABASE_SERVICE_ROLE_KEY"
  | "E2E_RUN_ID"
>;

/** Строгая зачистка данных текущего E2E-run; ошибка не должна исчезать бесследно. */
export default async function globalTeardown() {
  const failures: unknown[] = [];
  try {
    const { cookie: userSession } = await loginAsTelegramUser(
      API_URL,
      TELEGRAM_BOT_TOKEN,
      TEST_USER,
    );
    await api.post("/profile/register", userSession, {
      contactName: `${E2E_PREFIX} Тестовый пользователь`,
      contactPhone: "+77010000001",
    });
  } catch (error) {
    failures.push(error);
  }
  try {
    await cleanupE2eRun(cleanupEnv);
  } catch (error) {
    failures.push(error);
  } finally {
    try {
      await closeDb();
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length > 0) {
    throw new AggregateError(failures, `E2E teardown failed for ${failures.length} step(s)`);
  }
}
