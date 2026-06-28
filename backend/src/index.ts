import { createApp } from "./app";

const app = createApp({
  webappOrigin: Bun.env.WEBAPP_ORIGIN
});

const port = Number(Bun.env.PORT ?? 3000);

Bun.serve({
  port,
  fetch: app.fetch
});

console.info(`Backend listening on http://localhost:${port}`);
