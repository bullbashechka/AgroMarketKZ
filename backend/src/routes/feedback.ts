import { createFeedbackInput, feedbackMessageSchema } from "@agromarket/contracts";
import { Hono } from "hono";
import { getEnv, type HonoEnv } from "../env";
import { runInBackground } from "../lib/background";
import { assertUnderLimit } from "../lib/rateLimit";
import { formatFeedbackNotification, sendAdminNotification } from "../lib/telegramBot";
import { requireAuth } from "../middleware/auth";
import { requireRegistered } from "../middleware/registered";
import { countRecentFeedback, createFeedback, toFeedbackMessage } from "../repos/feedback";
import { getAdminChatId } from "../repos/settings";
import { findByTelegramId } from "../repos/users";

export const feedbackRoutes = new Hono<HonoEnv>();

feedbackRoutes.use("*", requireAuth, requireRegistered);

/** Приём сообщения из формы обратной связи. Мягкий антиспам-лимит. */
feedbackRoutes.post("/", async (c) => {
  const env = getEnv(c);
  const { userId, telegramId } = c.get("auth");
  const input = createFeedbackInput.parse(await c.req.json());

  assertUnderLimit(await countRecentFeedback(env, userId));

  const row = await createFeedback(env, userId, input);

  const chatId = await getAdminChatId(env);
  if (chatId) {
    const user = await findByTelegramId(env, telegramId);
    const html = formatFeedbackNotification({
      contactName: row.contact_name,
      contactPhone: row.contact_phone,
      message: row.message,
      telegramUsername: user?.telegram_username ?? null
    });
    runInBackground(c, sendAdminNotification(env, chatId, html));
  }

  return c.json(feedbackMessageSchema.parse(toFeedbackMessage(row)), 201);
});
