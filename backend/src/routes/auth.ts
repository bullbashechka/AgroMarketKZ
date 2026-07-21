import { authResponse, telegramLoginInput, widgetLoginInput } from "@agromarket/contracts";
import { Hono } from "hono";
import { getEnv, type HonoEnv } from "../env";
import { issueToken } from "../lib/jwt";
import { validateInitData, validateWidgetLogin } from "../lib/telegram";
import { toProfile, upsertFromTelegram } from "../repos/users";

export const authRoutes = new Hono<HonoEnv>();

/** Вход из Telegram Mini App: валидация `initData` → upsert пользователя → JWT. */
authRoutes.post("/telegram", async (c) => {
  const env = getEnv(c);
  const { initData } = telegramLoginInput.parse(await c.req.json());
  const tg = await validateInitData(initData, env.TELEGRAM_BOT_TOKEN);
  const row = await upsertFromTelegram(env, tg);
  const token = await issueToken(env, row.id, Number(row.telegram_id), row.token_version);
  return c.json(authResponse.parse({ token, profile: toProfile(row, env) }));
});

/** Вход в браузере через Telegram Login Widget: валидация подписи → upsert → JWT. */
authRoutes.post("/widget", async (c) => {
  const env = getEnv(c);
  const data = widgetLoginInput.parse(await c.req.json());
  const tg = await validateWidgetLogin(data, env.TELEGRAM_BOT_TOKEN);
  const row = await upsertFromTelegram(env, tg);
  const token = await issueToken(env, row.id, Number(row.telegram_id), row.token_version);
  return c.json(authResponse.parse({ token, profile: toProfile(row, env) }));
});
