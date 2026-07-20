import { createMiddleware } from "hono/factory";
import { getEnv, type HonoEnv } from "../env";
import { HttpError } from "../lib/errors";
import { verifyToken } from "../lib/jwt";
import { enforceAuthenticatedRateLimit } from "./rateLimit";

/** Требует валидный JWT в `Authorization: Bearer`; кладёт пользователя в контекст. */
export const requireAuth = createMiddleware<HonoEnv>(async (c, next) => {
  const header = c.req.header("Authorization");
  const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined;
  if (!token) {
    throw new HttpError(401, "Требуется авторизация");
  }

  try {
    const { userId, telegramId } = await verifyToken(getEnv(c), token);
    c.set("auth", { userId, telegramId });
  } catch {
    throw new HttpError(401, "Недействительный или истёкший токен");
  }

  await enforceAuthenticatedRateLimit(c);
  await next();
});
