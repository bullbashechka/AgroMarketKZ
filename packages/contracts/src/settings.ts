import { z } from "zod";
import { TELEGRAM_CONTACT_MAX, ADMIN_CHAT_ID_MAX } from "./constants";
import { kzPhoneSchema } from "./phone";

/** Публичные контакты площадки (ответ API для отклика и обратной связи). */
export const platformSettingsSchema = z.object({
  contactPhone: z.string().nullable(),
  whatsappPhone: z.string().nullable(),
  telegramContact: z.string().nullable(),
  email: z.string().nullable()
});

export type PlatformSettings = z.infer<typeof platformSettingsSchema>;

/**
 * Обновление настроек площадки (админ). Любое поле необязательно; `null` очищает значение.
 * Телефонные поля нормализуются к KZ-виду, email проверяется как email.
 */
export const updateSettingsInput = z.object({
  contactPhone: kzPhoneSchema.nullable().optional(),
  whatsappPhone: kzPhoneSchema.nullable().optional(),
  telegramContact: z.string().trim().max(TELEGRAM_CONTACT_MAX).nullable().optional(),
  email: z.email({ error: "Введите корректный email" }).nullable().optional(),
  adminChatId: z.string().trim().max(ADMIN_CHAT_ID_MAX).nullable().optional()
});

export type UpdateSettingsInput = z.infer<typeof updateSettingsInput>;
