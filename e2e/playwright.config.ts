import { defineConfig, devices } from "@playwright/test";
import path from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { config as loadEnv, parse as parseEnv } from "dotenv";
import { assertSafeE2EEnvironment } from "./helpers/safety";
import { resolveE2ERunId, telegramIdFor } from "./helpers/telegramIdentity";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const productionEnvPath = path.resolve(__dirname, "../.env");
// Root .env is optional and is read only for identity comparisons; its values are never inherited by E2E.
const productionEnv = existsSync(productionEnvPath)
  ? parseEnv(readFileSync(productionEnvPath, "utf8"))
  : {};
loadEnv({ path: path.resolve(__dirname, "../.env.e2e"), override: true });

const API_URL = process.env.E2E_API_URL ?? "http://127.0.0.1:3000";
const BASE_URL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:5173";
const E2E_DATABASE_URL = process.env.E2E_DATABASE_URL;
const E2E_SUPABASE_URL = process.env.E2E_SUPABASE_URL;
const E2E_SUPABASE_STORAGE_BUCKET = process.env.E2E_SUPABASE_STORAGE_BUCKET;
const E2E_SUPABASE_SERVICE_ROLE_KEY = process.env.E2E_SUPABASE_SERVICE_ROLE_KEY;
const E2E_TELEGRAM_BOT_TOKEN = process.env.E2E_TELEGRAM_BOT_TOKEN;

assertSafeE2EEnvironment({
  apiUrl: API_URL,
  baseUrl: BASE_URL,
  databaseUrl: E2E_DATABASE_URL,
  supabaseUrl: E2E_SUPABASE_URL,
  storageBucket: E2E_SUPABASE_STORAGE_BUCKET,
  telegramBotToken: E2E_TELEGRAM_BOT_TOKEN,
  storageServiceKey: E2E_SUPABASE_SERVICE_ROLE_KEY,
  productionApiUrl: productionEnv.VITE_API_URL,
  productionDatabaseUrl: productionEnv.DATABASE_URL,
  productionSupabaseUrl: productionEnv.SUPABASE_URL,
  productionTelegramBotToken: productionEnv.TELEGRAM_BOT_TOKEN,
  productionStorageServiceKey: productionEnv.SUPABASE_SERVICE_ROLE_KEY,
});

const requestedRunId = process.env.E2E_RUN_ID;
const runId = resolveE2ERunId(requestedRunId);
process.env.E2E_RUN_ID = runId;

const e2eUserTelegramId = telegramIdFor(runId, "fixture:shared-user");
const e2eAdminTelegramId = telegramIdFor(runId, "fixture:shared-admin");
process.env.E2E_TEST_USER_TG_ID = String(e2eUserTelegramId);
process.env.E2E_TEST_ADMIN_TG_ID = String(e2eAdminTelegramId);

const backendEnv = {
  DATABASE_URL: E2E_DATABASE_URL!,
  SUPABASE_URL: E2E_SUPABASE_URL!,
  SUPABASE_STORAGE_BUCKET: E2E_SUPABASE_STORAGE_BUCKET!,
  SUPABASE_SERVICE_ROLE_KEY: E2E_SUPABASE_SERVICE_ROLE_KEY!,
  TELEGRAM_BOT_TOKEN: E2E_TELEGRAM_BOT_TOKEN!,
  WEBAPP_ORIGIN: BASE_URL,
  ADMIN_ALLOWLIST: String(e2eAdminTelegramId),
  E2E_RUN_ID: runId,
};

export default defineConfig({
  testDir: "./tests",
  globalSetup: "./global-setup.ts",
  globalTeardown: "./global-teardown.ts",
  timeout: 60_000,
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  // Одна изолированная E2E-БД на run; внутри run тесты гоняем последовательно,
  // чтобы не создавать гонки за общие синтетические rate-limit identities.
  workers: 1,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "html",
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure"
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "bun run --cwd packages/contracts build && bun run dev:backend:e2e",
      cwd: "..",
      url: `${API_URL}/health`,
      env: backendEnv,
      reuseExistingServer: false,
      timeout: 60_000
    },
    {
      command: "bun run dev:webapp",
      cwd: "..",
      url: BASE_URL,
      env: { VITE_API_URL: API_URL },
      reuseExistingServer: false,
      timeout: 60_000
    }
  ]
});
