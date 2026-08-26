import { Hono } from "hono";
import { getDatabase, getEnv, type HonoEnv } from "../env";
import { HttpError } from "../lib/errors";
import { timingSafeEqual } from "../lib/telegram";
import { classifyUpdate, getTelegramUpdateId } from "../lib/telegramWebhook";
import { enforceAuthenticatedRateLimit } from "../middleware/rateLimit";
import { acceptTelegramUpdate, processTelegramUpdate } from "../repos/telegramUpdates";
import { parseAllowlist } from "../lib/admin";

export const telegramRoutes = new Hono<HonoEnv>();

/**
 * Telegram receives 200 only after the update is durable. Production enqueues
 * the id; local development processes it inline so the route remains usable
 * without a Queue binding.
 */
telegramRoutes.post("/webhook", async (c) => {
  const env = getEnv(c);
  const secret = c.req.header("X-Telegram-Bot-Api-Secret-Token") ?? "";
  if (!env.TELEGRAM_WEBHOOK_SECRET || !timingSafeEqual(secret, env.TELEGRAM_WEBHOOK_SECRET)) {
    throw new HttpError(401, "Неверный секрет вебхука");
  }

  const update = await c.req.json().catch(() => null);
  const updateId = getTelegramUpdateId(update);
  if (updateId === undefined) return c.json({ ok: true });
  const action = classifyUpdate(update, parseAllowlist(env));
  const db = getDatabase(c);
  const accepted = await acceptTelegramUpdate(env, updateId, action, db);
  if (!accepted) return c.json({ ok: true });

  if (env.TELEGRAM_UPDATE_QUEUE) {
    try {
      await env.TELEGRAM_UPDATE_QUEUE.send({ updateId });
    } catch {
      throw new HttpError(503, "Временная ошибка очереди вебхука", { retryable: true });
    }
  } else {
    const completed = await processTelegramUpdate(env, updateId, db);
    if (!completed) throw new HttpError(503, "Временная ошибка обработки вебхука", { retryable: true });
  }
  return c.json({ ok: true });
});

// Documents that this route intentionally relies on its secret, not browser auth.
void enforceAuthenticatedRateLimit;
