import { adminUserListQuery, adminUserListResponse } from "@agromarket/contracts";
import { Hono } from "hono";
import { getEnv, type HonoEnv } from "../../env";
import { listRegisteredUsers } from "../../repos/users";

export const adminUsersRoutes = new Hono<HonoEnv>();

/** Список зарегистрированных пользователей (собранные контакты). */
adminUsersRoutes.get("/", async (c) => {
  const env = getEnv(c);
  const query = adminUserListQuery.parse(c.req.query());
  const result = await listRegisteredUsers(env, query);
  return c.json(adminUserListResponse.parse(result));
});
