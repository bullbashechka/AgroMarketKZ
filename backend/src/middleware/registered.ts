import { createMiddleware } from "hono/factory";
import { getDb } from "../db";
import { getEnv, type HonoEnv } from "../env";
import { HttpError } from "../lib/errors";

/**
 * Требует завершённую регистрацию (имя+телефон сохранены). Ставится ПОСЛЕ `requireAuth`:
 * JWT выдаётся до регистрации, поэтому статус проверяется по БД, а не по токену.
 */
export const requireRegistered = createMiddleware<HonoEnv>(async (c, next) => {
  const sql = getDb(getEnv(c));
  const { userId } = c.get("auth");
  const [row] = await sql<{ registered_at: Date | null }[]>`
    select registered_at from users where id = ${userId} limit 1
  `;
  if (!row || row.registered_at === null) {
    throw new HttpError(403, "Требуется регистрация");
  }
  await next();
});
