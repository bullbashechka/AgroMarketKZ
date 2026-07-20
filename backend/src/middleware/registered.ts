import { createMiddleware } from "hono/factory";
import type { HonoEnv } from "../env";
import { HttpError } from "../lib/errors";

/**
 * Требует завершённую регистрацию (имя+телефон сохранены). Ставится ПОСЛЕ `requireAuth`:
 * JWT выдаётся до регистрации, поэтому статус проверяется по БД, а не по токену.
 */
export const requireRegistered = createMiddleware<HonoEnv>(async (c, next) => {
  if (!c.get("auth").isRegistered) {
    throw new HttpError(403, "Требуется регистрация");
  }
  await next();
});
