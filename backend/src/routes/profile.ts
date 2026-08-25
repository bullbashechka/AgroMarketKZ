import {
  deleteAccountInput,
  profileSchema,
  registerInput,
  updateProfileInput,
  verifyContactInput,
  verifyContactResponse
} from "@agromarket/contracts";
import { Hono } from "hono";
import { getEnv, type HonoEnv } from "../env";
import { HttpError } from "../lib/errors";
import { tryValidateContactPhoneForUser, validateContactPhoneForUser } from "../lib/contact";
import { requireAuth } from "../middleware/auth";
import { findByTelegramId, register, toProfile, updateContacts } from "../repos/users";
import { deleteAccount } from "../repos/privacy";
import { clearSessionCookie } from "../lib/session";

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
  const { userId, telegramId } = c.get("auth");
  const data = registerInput.parse(await c.req.json());
  const verifiedPhone = await tryValidateContactPhoneForUser(data.contactResponse, telegramId, env);
  const row = await register(env, userId, data, verifiedPhone);
  return c.json(profileSchema.parse(toProfile(row, env)));
});

/**
 * Верификация телефона подписанным контактом Telegram (requestContact из Mini App).
 * Доступна до регистрации — вызывается из формы регистрации. Проверяет подпись,
 * принадлежность контакта текущему пользователю и ничего не записывает.
 */
profileRoutes.post("/contact", async (c) => {
  const env = getEnv(c);
  const { telegramId } = c.get("auth");
  const { response } = verifyContactInput.parse(await c.req.json());

  const phone = await validateContactPhoneForUser(response, telegramId, env);
  return c.json(verifyContactResponse.parse({ phone, response }));
});

/** Редактирование контактных данных в профиле. */
profileRoutes.put("/", async (c) => {
  const env = getEnv(c);
  const { userId } = c.get("auth");
  const data = updateProfileInput.parse(await c.req.json());
  const row = await updateContacts(env, userId, data);
  return c.json(profileSchema.parse(toProfile(row, env)));
});

/** Самообслуживаемое удаление: PII обезличивается, все сессии отзываются. */
profileRoutes.delete("/", async (c) => {
  deleteAccountInput.parse(await c.req.json());
  await deleteAccount(getEnv(c), c.get("auth").userId);
  clearSessionCookie(c);
  return c.body(null, 204);
});
