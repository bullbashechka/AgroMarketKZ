import { createRequestInput, requestSchema } from "@agromarket/contracts";
import { Hono } from "hono";
import { getEnv, type HonoEnv } from "../env";
import { runInBackground } from "../lib/background";
import { tryValidateContactPhoneForUser } from "../lib/contact";
import { HttpError } from "../lib/errors";
import { assertUnderLimit } from "../lib/rateLimit";
import { requestPayloadHash } from "../lib/requestIdempotency";
import { buildRequestDeepLink, formatRequestNotification, sendAdminNotification } from "../lib/telegramBot";
import { requireAuth } from "../middleware/auth";
import {
  createRequest,
  findRequestByClientId,
  requestRateLimitState,
  toRequest,
} from "../repos/requests";
import { getAdminChatId } from "../repos/settings";
import { findByTelegramId } from "../repos/users";

export const requestsRoutes = new Hono<HonoEnv>();

requestsRoutes.use("*", requireAuth);

/** Создание заявки (из карточки / с вкладки / из профиля). Мягкий антиспам-лимит. */
requestsRoutes.post("/", async (c) => {
  const env = getEnv(c);
  const { userId, telegramId } = c.get("auth");
  const input = createRequestInput.parse(await c.req.json());
  const payloadHash = await requestPayloadHash(input);

  const replay = await findRequestByClientId(env, userId, input.clientRequestId);
  if (replay) {
    if (replay.request_payload_hash !== payloadHash) {
      throw new HttpError(409, "Эта попытка отправки уже использована для другой заявки");
    }
    return c.json(requestSchema.parse(toRequest(replay)), 200);
  }

  const rate = await requestRateLimitState(env, userId);
  assertUnderLimit(rate.count, rate.retryAfterSeconds);

  const verifiedPhone = await tryValidateContactPhoneForUser(input.contactResponse, telegramId, env);
  const { row, created } = await createRequest(env, userId, input, payloadHash, verifiedPhone);

  const chatId = created ? await getAdminChatId(env) : null;
  if (chatId) {
    const user = await findByTelegramId(env, telegramId);
    const html = formatRequestNotification({
      source: row.source,
      tabType: row.tab_type,
      cardTitleSnapshot: row.card_title_snapshot,
      cardPriceTypeSnapshot: row.card_price_type_snapshot,
      cardPriceAmountSnapshot: row.card_price_amount_snapshot,
      cardPriceUnitSnapshot: row.card_price_unit_snapshot,
      cardPriceReasonSnapshot: row.card_price_reason_snapshot,
      contactName: row.contact_name,
      contactPhone: row.contact_phone,
      contactPhoneVerified: row.contact_phone_verified,
      comment: row.comment,
      telegramUsername: user?.telegram_username ?? null
    });
    const deepLink = buildRequestDeepLink(env, row.id);
    const replyMarkup = deepLink
      ? { inline_keyboard: [[{ text: "Открыть заявку", url: deepLink }]] }
      : undefined;
    runInBackground(c, sendAdminNotification(env, chatId, html, replyMarkup));
  }

  return c.json(requestSchema.parse(toRequest(row)), created ? 201 : 200);
});
