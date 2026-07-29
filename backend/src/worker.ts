import { createApp } from "./app";
import { resolveEnv, type AppEnv } from "./env";
import { runDbHealthAlertCheck } from "./lib/alerts";
import { runStorageCleanup } from "./lib/storageCleanup";

const app = createApp();

export default {
  fetch: app.fetch,
  async scheduled(event, env: Partial<AppEnv>, ctx) {
    const resolved = resolveEnv(env, undefined);
    if (event.cron === "*/5 * * * *") {
      ctx.waitUntil(runDbHealthAlertCheck(resolved));
    } else {
      ctx.waitUntil(runStorageCleanup(resolved));
    }
  }
} satisfies ExportedHandler<Partial<AppEnv>>;
