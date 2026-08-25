import { z } from "zod";
import { profileSchema } from "./profile";

/** Вход из Telegram Mini App: сырая строка `initData` от Telegram Web Apps SDK. */
export const telegramLoginInput = z.object({
  initData: z.string().min(1, { error: "Отсутствуют данные Telegram" })
});

export type TelegramLoginInput = z.infer<typeof telegramLoginInput>;

/**
 * Вход в обычном браузере через Telegram Login Widget.
 * Поля приходят от виджета; подпись (`hash`) и `auth_date` проверяет backend.
 */
export const widgetLoginInput = z.object({
  id: z.number().int(),
  first_name: z.string(),
  last_name: z.string().optional(),
  username: z.string().optional(),
  photo_url: z.string().optional(),
  auth_date: z.number().int(),
  hash: z.string().min(1)
});

export type WidgetLoginInput = z.infer<typeof widgetLoginInput>;

/** Единый ответ обоих логинов: cookie ставит сервер, клиент получает только профиль. */
export const authResponse = z.object({
  profile: profileSchema
});

export type AuthResponse = z.infer<typeof authResponse>;

/** Явное подтверждение необратимого удаления учётной записи. */
export const deleteAccountInput = z.object({
  confirmed: z.literal(true)
});

export type DeleteAccountInput = z.infer<typeof deleteAccountInput>;
