import { defineConfig, devices } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// корневой .env (совпадает с тем, что использует `bun run dev`) + отдельный .env.e2e
// с тестовыми Telegram id, чтобы не мешать их с боевыми значениями в одном файле.
loadEnv({ path: path.resolve(__dirname, "../.env") });
loadEnv({ path: path.resolve(__dirname, "../.env.e2e") });

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:5173";

export default defineConfig({
  testDir: "./tests",
  globalTeardown: "./global-teardown.ts",
  timeout: 60_000,
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  // Один общий dev-Supabase на все тесты — параллельные воркеры бьют по одним и тем же
  // telegram id/строкам и вызывают гонки; гоняем последовательно.
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
      command: "bun run --cwd packages/contracts build && bun run dev:backend",
      cwd: "..",
      url: "http://localhost:3000/health",
      reuseExistingServer: !process.env.CI,
      timeout: 60_000
    },
    {
      command: "bun run dev:webapp",
      cwd: "..",
      url: BASE_URL,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000
    }
  ]
});
