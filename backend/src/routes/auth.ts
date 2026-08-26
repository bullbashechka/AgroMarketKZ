import { authResponse, telegramLoginInput, widgetLoginInput } from "@agromarket/contracts";
import { Hono, type Context } from "hono";
import { getDatabase, getEnv, type HonoEnv } from "../env";
import { clearSessionCookie, sessionTokenFromRequest, setSessionCookie } from "../lib/session";
import { validateInitData, validateWidgetLogin } from "../lib/telegram";
import { requireAuth } from "../middleware/auth";
import { enforceAuthRateLimit } from "../middleware/rateLimit";
import {
  exchangeTelegramSession,
  exchangeWidgetTelegramSession,
  revokeAllUserSessions,
  revokeSession,
} from "../repos/sessions";
import { toProfile } from "../repos/users";

export const authRoutes = new Hono<HonoEnv>();

authRoutes.use("*", enforceAuthRateLimit);

/** Вход из Telegram Mini App: валидация `initData` → атомарный upsert + opaque session. */
authRoutes.post("/telegram", async (c) => {
  const env = getEnv(c);
  const { initData } = telegramLoginInput.parse(await c.req.json().catch(() => null));
  const { user: tg, authDate } = await validateInitData(initData, env.TELEGRAM_BOT_TOKEN);
  const db = getDatabase(c);
  const { row, token } = await exchangeTelegramSession(env, tg, authDate, db);
  setSessionCookie(c, token);
  return c.json(authResponse.parse({ profile: toProfile(row, env) }));
});

/** Вход в браузере через Telegram Login Widget: proof + upsert + session atomically. */
const widgetLoginHandler = async (c: Context<HonoEnv>) => {
  const env = getEnv(c);
  const data = widgetLoginInput.parse(await c.req.json().catch(() => null));
  const tg = await validateWidgetLogin(data, env.TELEGRAM_BOT_TOKEN);
  const db = getDatabase(c);
  const { row, token } = await exchangeWidgetTelegramSession(env, tg, data.hash, data.auth_date, db);
  setSessionCookie(c, token);
  return c.json(authResponse.parse({ profile: toProfile(row, env) }));
};

// New browser exchange endpoint. `/widget` remains as a compatibility alias
// during the rollout; both paths consume the same one-time proof.
authRoutes.post("/widget/exchange", widgetLoginHandler);
authRoutes.post("/widget", widgetLoginHandler);

authRoutes.post("/logout", async (c) => {
  const token = sessionTokenFromRequest(c);
  if (token) await revokeSession(getEnv(c), token, getDatabase(c));
  clearSessionCookie(c);
  return c.body(null, 204);
});

authRoutes.post("/logout-all", requireAuth, async (c) => {
  await revokeAllUserSessions(getEnv(c), c.get("auth").userId, getDatabase(c));
  clearSessionCookie(c);
  return c.body(null, 204);
});
