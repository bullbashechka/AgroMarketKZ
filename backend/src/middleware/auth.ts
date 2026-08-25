import { createMiddleware } from "hono/factory";
import { getEnv, type HonoEnv } from "../env";
import { HttpError } from "../lib/errors";
import { sessionTokenFromRequest, setSessionCookie } from "../lib/session";
import { findSessionAuthUser } from "../repos/sessions";
import { enforceAuthenticatedRateLimit } from "./rateLimit";

type AuthUserLookup = typeof findSessionAuthUser;

/** Создаёт middleware авторизации; session lookup всегда читает strongly-consistent PostgreSQL. */
export function createRequireAuth(authUserLookup: AuthUserLookup = findSessionAuthUser) {
  return createMiddleware<HonoEnv>(async (c, next) => {
    const token = sessionTokenFromRequest(c);
    if (!token) {
      throw new HttpError(401, "Требуется авторизация");
    }

    const user = await authUserLookup(getEnv(c), token);
    if (!user) {
      throw new HttpError(401, "Недействительная или истёкшая сессия");
    }
    if (user.rotatedToken) setSessionCookie(c, user.rotatedToken);
    c.set("auth", { userId: user.userId, telegramId: user.telegramId, isRegistered: user.isRegistered });

    await enforceAuthenticatedRateLimit(c);
    await next();
  });
}

/** Требует валидную HttpOnly-сессию; кладёт пользователя в контекст. */
export const requireAuth = createRequireAuth();
