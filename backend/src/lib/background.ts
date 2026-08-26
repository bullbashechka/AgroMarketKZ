import type { Context } from "hono";
import type { HonoEnv } from "../env";

function logBackgroundError(err: unknown): void {
  console.error("runInBackground: фоновая задача завершилась с ошибкой", err);
}

/**
 * Запускает промис в фоне, не блокируя ответ. На Cloudflare Workers использует
 * `executionCtx.waitUntil` (гарантирует завершение задачи после отправки ответа);
 * локально на Bun `executionCtx` недоступен — падает на обычный fire-and-forget.
 */
export function runInBackground(c: Context<HonoEnv>, task: Promise<unknown>): void {
  const tracked = task.catch(logBackgroundError);
  const tasks = c.get("backgroundTasks");
  tasks.add(tracked);
  void tracked.finally(() => tasks.delete(tracked));
  try {
    c.executionCtx.waitUntil(tracked);
  } catch {
    // Bun has no execution context. The request lifecycle awaits the tracked
    // promise before disposing its invocation-owned DB capability.
  }
}
