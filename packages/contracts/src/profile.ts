import { z } from "zod";
import { contactNameSchema } from "./primitives";
import { phoneSchema } from "./phone";

/** Профиль пользователя (ответ API). `isAdmin` вычисляется backend по allowlist. */
export const profileSchema = z.object({
  id: z.uuid(),
  telegramId: z.number().int(),
  telegramUsername: z.string().nullable(),
  telegramFirstName: z.string().nullable(),
  telegramLastName: z.string().nullable(),
  contactName: z.string().nullable(),
  contactPhone: z.string().nullable(),
  phoneVerified: z.boolean(),
  isRegistered: z.boolean(),
  registeredAt: z.iso.datetime().nullable(),
  isAdmin: z.boolean(),
  createdAt: z.iso.datetime()
});

export type Profile = z.infer<typeof profileSchema>;

/** Регистрация при первом входе: имя + телефон. */
export const registerInput = z.object({
  contactName: contactNameSchema,
  contactPhone: phoneSchema,
  contactResponse: z.string().min(1).optional(),
});

export type RegisterInput = z.infer<typeof registerInput>;

/** Редактирование контактных данных в профиле — те же поля. */
export const updateProfileInput = registerInput;
export type UpdateProfileInput = z.infer<typeof updateProfileInput>;

/**
 * Верификация телефона подписанным контактом Telegram: `response` — сырая строка
 * из события requestContact Mini App (подписана ботом, проверяется на сервере).
 */
export const verifyContactInput = z.object({
  response: z.string().min(1, { error: "Пустой ответ Telegram" })
});

export type VerifyContactInput = z.infer<typeof verifyContactInput>;

/** Ответ верификации: нормализованный (E.164) подтверждённый номер для предзаполнения. */
export const verifyContactResponse = z.object({
  phone: z.string(),
  response: z.string(),
});

export type VerifyContactResponse = z.infer<typeof verifyContactResponse>;
