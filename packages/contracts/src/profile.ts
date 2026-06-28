import { z } from "zod";
import { contactNameSchema } from "./primitives";
import { kzPhoneSchema } from "./phone";

/** Профиль пользователя (ответ API). `isAdmin` вычисляется backend по allowlist. */
export const profileSchema = z.object({
  id: z.uuid(),
  telegramId: z.number().int(),
  telegramUsername: z.string().nullable(),
  telegramFirstName: z.string().nullable(),
  telegramLastName: z.string().nullable(),
  contactName: z.string().nullable(),
  contactPhone: z.string().nullable(),
  isRegistered: z.boolean(),
  registeredAt: z.iso.datetime().nullable(),
  isAdmin: z.boolean(),
  createdAt: z.iso.datetime()
});

export type Profile = z.infer<typeof profileSchema>;

/** Регистрация при первом входе: имя + телефон. */
export const registerInput = z.object({
  contactName: contactNameSchema,
  contactPhone: kzPhoneSchema
});

export type RegisterInput = z.infer<typeof registerInput>;

/** Редактирование контактных данных в профиле — те же поля. */
export const updateProfileInput = registerInput;
export type UpdateProfileInput = z.infer<typeof updateProfileInput>;
