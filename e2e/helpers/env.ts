export const API_URL = process.env.E2E_API_URL ?? "http://127.0.0.1:3000";
export const BASE_URL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:5173";
export const TELEGRAM_BOT_TOKEN = process.env.E2E_TELEGRAM_BOT_TOKEN ?? "";

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var ${name} for e2e tests (see .env.example)`);
  }
  return value;
}
