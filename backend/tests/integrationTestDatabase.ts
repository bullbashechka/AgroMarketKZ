import { describe } from "bun:test";
import postgres from "postgres";
import { createDatabaseInvocation } from "../src/db";
import type { AppEnv } from "../src/env";

export const databaseUrl = process.env.TEST_DATABASE_URL;
export const describeIntegration = databaseUrl ? describe : describe.skip;

export const integrationEnv: AppEnv = {
  APP_ENV: "development",
  WEBAPP_ORIGIN: "http://127.0.0.1:5173",
  TELEGRAM_BOT_TOKEN: "integration-only-bot-token",
  ADMIN_ALLOWLIST: "",
  DATABASE_URL: databaseUrl ?? "postgresql://127.0.0.1:1/disabled",
  SUPABASE_URL: "https://integration-only.invalid",
  SUPABASE_STORAGE_BUCKET: "card-images",
  SUPABASE_SERVICE_ROLE_KEY: "integration-only-service-role-key",
};

export function openIntegrationSql() {
  return postgres(integrationEnv.DATABASE_URL!, { prepare: false, max: 8 });
}

export function openIntegrationDatabase(env: AppEnv = integrationEnv) {
  return createDatabaseInvocation(env);
}
