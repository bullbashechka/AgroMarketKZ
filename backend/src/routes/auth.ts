import { authResponse, telegramLoginInput, widgetLoginInput } from "@agromarket/contracts";
import { Hono, type Context } from "hono";
import { getEnv, type HonoEnv } from "../env";
import { issueToken } from "../lib/jwt";
import { validateInitData, validateWidgetLogin } from "../lib/telegram";
import { enforceAuthRateLimit } from "../middleware/rateLimit";
import { consumeWidgetAuthProof } from "../repos/authProofs";
import { toProfile, upsertFromTelegram } from "../repos/users";

export const authRoutes = new Hono<HonoEnv>();

authRoutes.use("*", enforceAuthRateLimit);

/** Вход из Telegram Mini App: валидация `initData` → upsert пользователя → JWT. */
authRoutes.post("/telegram", async (c) => {
  const env = getEnv(c);
  const { initData } = telegramLoginInput.parse(await c.req.json().catch(() => null));
  const tg = await validateInitData(initData, env.TELEGRAM_BOT_TOKEN);
  const row = await upsertFromTelegram(env, tg);
  const token = await issueToken(env, row.id, Number(row.telegram_id), row.token_version);
  return c.json(authResponse.parse({ token, profile: toProfile(row, env) }));
});

/** Вход в браузере через Telegram Login Widget: proof → upsert → JWT. */
const widgetLoginHandler = async (c: Context<HonoEnv>) => {
  const env = getEnv(c);
  const data = widgetLoginInput.parse(await c.req.json().catch(() => null));
  const tg = await validateWidgetLogin(data, env.TELEGRAM_BOT_TOKEN);
  const row = await upsertFromTelegram(env, tg);
  // Consume after the idempotent user upsert: a transient DB failure cannot
  // burn the five-minute Telegram proof before the account is usable.
  await consumeWidgetAuthProof(env, data.hash, tg.id, data.auth_date);
  const token = await issueToken(env, row.id, Number(row.telegram_id), row.token_version);
  return c.json(authResponse.parse({ token, profile: toProfile(row, env) }));
};

// New browser exchange endpoint. `/widget` remains as a compatibility alias
// during the rollout; both paths consume the same one-time proof.
authRoutes.post("/widget/exchange", widgetLoginHandler);
authRoutes.post("/widget", widgetLoginHandler);
