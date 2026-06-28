import { profileSchema, registerInput, updateProfileInput } from "@agromarket/contracts";
import { Hono } from "hono";
import { getEnv, type HonoEnv } from "../env";
import { HttpError } from "../lib/errors";
import { requireAuth } from "../middleware/auth";
import { findByTelegramId, register, toProfile, updateContacts } from "../repos/users";

export const profileRoutes = new Hono<HonoEnv>();

profileRoutes.use("*", requireAuth);

/** Текущий профиль (с живым `isAdmin`). */
profileRoutes.get("/", async (c) => {
  const env = getEnv(c);
  const { telegramId } = c.get("auth");
  const row = await findByTelegramId(env, telegramId);
  if (!row) {
    throw new HttpError(404, "Пользователь не найден");
  }
  return c.json(profileSchema.parse(toProfile(row, env)));
});

/** Регистрация при первом входе: имя + телефон. */
profileRoutes.post("/register", async (c) => {
  const env = getEnv(c);
  const { userId } = c.get("auth");
  const data = registerInput.parse(await c.req.json());
  const row = await register(env, userId, data);
  return c.json(profileSchema.parse(toProfile(row, env)));
});

/** Редактирование контактных данных в профиле. */
profileRoutes.put("/", async (c) => {
  const env = getEnv(c);
  const { userId } = c.get("auth");
  const data = updateProfileInput.parse(await c.req.json());
  const row = await updateContacts(env, userId, data);
  return c.json(profileSchema.parse(toProfile(row, env)));
});
