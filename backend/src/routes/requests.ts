import { createRequestInput, requestSchema } from "@agromarket/contracts";
import { Hono } from "hono";
import { getEnv, type HonoEnv } from "../env";
import { runInBackground } from "../lib/background";
import { assertUnderLimit } from "../lib/rateLimit";
import { formatRequestNotification, sendAdminNotification } from "../lib/telegramBot";
import { requireAuth } from "../middleware/auth";
import { requireRegistered } from "../middleware/registered";
import { countRecentRequests, createRequest, toRequest } from "../repos/requests";
import { getAdminChatId } from "../repos/settings";
import { findByTelegramId } from "../repos/users";

export const requestsRoutes = new Hono<HonoEnv>();

requestsRoutes.use("*", requireAuth, requireRegistered);

/** Создание заявки (из карточки / с вкладки / из профиля). Мягкий антиспам-лимит. */
requestsRoutes.post("/", async (c) => {
  const env = getEnv(c);
  const { userId, telegramId } = c.get("auth");
  const input = createRequestInput.parse(await c.req.json());

  assertUnderLimit(await countRecentRequests(env, userId));

  const row = await createRequest(env, userId, input);

  const chatId = await getAdminChatId(env);
  if (chatId) {
    const user = await findByTelegramId(env, telegramId);
    const html = formatRequestNotification({
      source: row.source,
      tabType: row.tab_type,
      cardTitleSnapshot: row.card_title_snapshot,
      cardPriceTypeSnapshot: row.card_price_type_snapshot,
      cardPriceAmountSnapshot: row.card_price_amount_snapshot,
      contactName: row.contact_name,
      contactPhone: row.contact_phone,
      comment: row.comment,
      telegramUsername: user?.telegram_username ?? null
    });
    runInBackground(c, sendAdminNotification(env, chatId, html));
  }

  return c.json(requestSchema.parse(toRequest(row)), 201);
});
