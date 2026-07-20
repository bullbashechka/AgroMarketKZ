import { normalizePhone } from "@agromarket/contracts";
import type { AppEnv } from "../env";
import { HttpError } from "./errors";
import { validateContactResponse } from "./telegram";

export async function validateContactPhoneForUser(
  response: string,
  telegramId: number,
  env: AppEnv,
): Promise<string> {
  const contact = await validateContactResponse(response, env.TELEGRAM_BOT_TOKEN);
  if (contact.userId !== telegramId) {
    throw new HttpError(403, "Контакт принадлежит другому пользователю Telegram");
  }
  const raw = contact.phoneNumber.startsWith("+") ? contact.phoneNumber : `+${contact.phoneNumber}`;
  const phone = normalizePhone(raw);
  if (!phone) throw new HttpError(400, "Не удалось распознать номер телефона из Telegram");
  return phone;
}

/** Ошибка/истечение proof не мешает ручному номеру, но такой номер не считается подтверждённым. */
export async function tryValidateContactPhoneForUser(
  response: string | undefined,
  telegramId: number,
  env: AppEnv,
): Promise<string | null> {
  if (!response) return null;
  try {
    return await validateContactPhoneForUser(response, telegramId, env);
  } catch {
    return null;
  }
}
