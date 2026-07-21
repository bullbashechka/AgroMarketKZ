import { createApp } from "./app";
import { resolveEnv, type AppEnv } from "./env";
import { runStorageCleanup } from "./lib/storageCleanup";

const app = createApp();

export default {
  fetch: app.fetch,
  async scheduled(_event, env: Partial<AppEnv>, ctx) {
    ctx.waitUntil(runStorageCleanup(resolveEnv(env, undefined)));
  }
} satisfies ExportedHandler<Partial<AppEnv>>;
