import { createMiddleware } from "hono/factory";
import { getEnv, type HonoEnv } from "../env";
import { isAdmin } from "../lib/admin";
import { HttpError } from "../lib/errors";

/**
 * Требует прав администратора. Ставится ПОСЛЕ `requireAuth`.
 * Проверка живая — по актуальному `ADMIN_ALLOWLIST`, чтобы выдача/снятие прав
 * вступали в силу мгновенно (статус не зашит в токен).
 */
export const requireAdmin = createMiddleware<HonoEnv>(async (c, next) => {
  const auth = c.get("auth");
  if (!auth || !isAdmin(auth.telegramId, getEnv(c))) {
    throw new HttpError(403, "Доступ только для администраторов");
  }
  await next();
});
