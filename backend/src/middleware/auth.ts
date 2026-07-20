import { createMiddleware } from "hono/factory";
import { getEnv, type HonoEnv } from "../env";
import { HttpError } from "../lib/errors";
import { verifyToken } from "../lib/jwt";
import { findAuthUser } from "../repos/users";
import { enforceAuthenticatedRateLimit } from "./rateLimit";

type AuthUserLookup = typeof findAuthUser;

/** Создаёт middleware авторизации; lookup выделен для изолированной проверки границ JWT и БД. */
export function createRequireAuth(authUserLookup: AuthUserLookup = findAuthUser) {
  return createMiddleware<HonoEnv>(async (c, next) => {
    const header = c.req.header("Authorization");
    const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined;
    if (!token) {
      throw new HttpError(401, "Требуется авторизация");
    }

    let claims: Awaited<ReturnType<typeof verifyToken>>;
    try {
      claims = await verifyToken(getEnv(c), token);
    } catch {
      throw new HttpError(401, "Недействительный или истёкший токен");
    }

    const user = await authUserLookup(getEnv(c), claims.userId, claims.telegramId);
    if (!user || user.tokenVersion !== claims.tokenVersion) {
      throw new HttpError(401, "Недействительный или истёкший токен");
    }
    c.set("auth", { userId: claims.userId, telegramId: claims.telegramId, isRegistered: user.isRegistered });

    await enforceAuthenticatedRateLimit(c);
    await next();
  });
}

/** Требует валидный JWT в `Authorization: Bearer`; кладёт пользователя в контекст. */
export const requireAuth = createRequireAuth();
