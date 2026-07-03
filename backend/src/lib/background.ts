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
  try {
    c.executionCtx.waitUntil(task.catch(logBackgroundError));
  } catch {
    void task.catch(logBackgroundError);
  }
}
