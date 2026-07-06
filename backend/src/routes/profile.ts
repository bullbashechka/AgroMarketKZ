import {
  normalizePhone,
  profileSchema,
  registerInput,
  updateProfileInput,
  verifyContactInput,
  verifyContactResponse
} from "@agromarket/contracts";
import { Hono } from "hono";
import { getEnv, type HonoEnv } from "../env";
import { HttpError } from "../lib/errors";
import { validateContactResponse } from "../lib/telegram";
import { requireAuth } from "../middleware/auth";
import { findByTelegramId, register, setVerifiedPhone, toProfile, updateContacts } from "../repos/users";

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

/**
 * Верификация телефона подписанным контактом Telegram (requestContact из Mini App).
 * Доступна до регистрации — вызывается из формы регистрации. Проверяет подпись,
 * принадлежность контакта текущему пользователю и сохраняет verified_phone.
 */
profileRoutes.post("/contact", async (c) => {
  const env = getEnv(c);
  const { userId, telegramId } = c.get("auth");
  const { response } = verifyContactInput.parse(await c.req.json());

  const contact = await validateContactResponse(response, env.TELEGRAM_BOT_TOKEN);
  if (contact.userId !== telegramId) {
    throw new HttpError(403, "Контакт принадлежит другому пользователю Telegram");
  }

  // Telegram отдаёт полный международный номер, но может без «+».
  const raw = contact.phoneNumber.startsWith("+") ? contact.phoneNumber : `+${contact.phoneNumber}`;
  const phone = normalizePhone(raw);
  if (!phone) {
    throw new HttpError(400, "Не удалось распознать номер телефона из Telegram");
  }

  await setVerifiedPhone(env, userId, phone);
  return c.json(verifyContactResponse.parse({ phone }));
});

/** Редактирование контактных данных в профиле. */
profileRoutes.put("/", async (c) => {
  const env = getEnv(c);
  const { userId } = c.get("auth");
  const data = updateProfileInput.parse(await c.req.json());
  const row = await updateContacts(env, userId, data);
  return c.json(profileSchema.parse(toProfile(row, env)));
});
