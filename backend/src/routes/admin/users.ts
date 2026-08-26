import { adminUserListQuery, adminUserListResponse } from "@agromarket/contracts";
import { Hono } from "hono";
import { z } from "zod";
import { getDatabase, getEnv, type HonoEnv } from "../../env";
import { runAdminMutation } from "../../lib/adminAuditRequest";
import { HttpError } from "../../lib/errors";
import { listRegisteredUsers } from "../../repos/users";
import { revokeAllUserSessions } from "../../repos/sessions";

export const adminUsersRoutes = new Hono<HonoEnv>();

/** Список зарегистрированных пользователей (собранные контакты). */
adminUsersRoutes.get("/", async (c) => {
  const env = getEnv(c);
  const query = adminUserListQuery.parse(c.req.query());
  const result = await listRegisteredUsers(env, query, getDatabase(c));
  return c.json(adminUserListResponse.parse(result));
});

/** Немедленно отзывает все opaque-сессии пользователя в PostgreSQL. */
adminUsersRoutes.post("/:id/revoke-sessions", async (c) => {
  const userId = z.string().uuid().parse(c.req.param("id"));
  await runAdminMutation(c, 204, (audit) => revokeAllUserSessions(getEnv(c), userId, getDatabase(c), audit));
  return c.body(null, 204);
});
