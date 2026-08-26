import { createRequestInput, requestSchema } from "@agromarket/contracts";
import { Hono } from "hono";
import { getDatabase, getEnv, type HonoEnv } from "../env";
import { runInBackground } from "../lib/background";
import { tryValidateContactPhoneForUser } from "../lib/contact";
import { HttpError } from "../lib/errors";
import { dispatchNotificationForEntity } from "../lib/notificationOutbox";
import { requestPayloadHash } from "../lib/requestIdempotency";
import { requireAuth } from "../middleware/auth";
import { createRequest, findRequestByClientId, toRequest } from "../repos/requests";

export const requestsRoutes = new Hono<HonoEnv>();

requestsRoutes.use("*", requireAuth);

/** Создание заявки (из карточки / с вкладки / из профиля). Мягкий антиспам-лимит. */
requestsRoutes.post("/", async (c) => {
  const env = getEnv(c);
  const { userId, telegramId } = c.get("auth");
  const db = getDatabase(c);
  const input = createRequestInput.parse(await c.req.json());
  const payloadHash = await requestPayloadHash(input);

  const replay = await findRequestByClientId(env, userId, input.clientRequestId, db);
  if (replay) {
    if (replay.request_payload_hash !== payloadHash) {
      throw new HttpError(409, "Эта попытка отправки уже использована для другой заявки");
    }
    return c.json(requestSchema.parse(await toRequest(env, replay, db)), 200);
  }

  const verifiedPhone = await tryValidateContactPhoneForUser(input.contactResponse, telegramId, env);
  const { row, created } = await createRequest(env, userId, input, payloadHash, verifiedPhone, db);
  const request = await toRequest(env, row, db);

  if (created) runInBackground(c, dispatchNotificationForEntity(env, "request", row.id, db));

  return c.json(requestSchema.parse(request), created ? 201 : 200);
});
