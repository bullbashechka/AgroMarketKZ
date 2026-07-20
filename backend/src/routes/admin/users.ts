import { adminUserListQuery, adminUserListResponse } from "@agromarket/contracts";
import { Hono } from "hono";
import { z } from "zod";
import { getEnv, type HonoEnv } from "../../env";
import { HttpError } from "../../lib/errors";
import { listRegisteredUsers, revokeUserSessions } from "../../repos/users";

export const adminUsersRoutes = new Hono<HonoEnv>();

/** Список зарегистрированных пользователей (собранные контакты). */
adminUsersRoutes.get("/", async (c) => {
  const env = getEnv(c);
  const query = adminUserListQuery.parse(c.req.query());
  const result = await listRegisteredUsers(env, query);
  return c.json(adminUserListResponse.parse(result));
});

/** Отзывает все выданные JWT пользователя через инкремент его версии сессии. */
adminUsersRoutes.post("/:id/revoke-sessions", async (c) => {
  const userId = z.string().uuid().parse(c.req.param("id"));
  const revoked = await revokeUserSessions(getEnv(c), userId);
  if (!revoked) throw new HttpError(404, "Пользователь не найден");
  return c.body(null, 204);
});
