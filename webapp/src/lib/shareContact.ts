import type { VerifyContactResponse } from "@agromarket/contracts";
import { apiPost } from "./api";
import { requestTelegramContact } from "./telegram";

/**
 * Полный цикл «Поделиться контактом»: нативный запрос → серверная верификация
 * подписанного ответа (сохраняет verified_phone в профиле) → нормализованный номер
 * для предзаполнения. Если подписи нет или проверка не прошла (старый клиент,
 * сбой сети) — деградируем до неверифицированного номера из ответа Telegram.
 * `null` — пользователь отказался или мы вне Telegram.
 */
export async function sharePhoneFromTelegram(): Promise<string | null> {
  const shared = await requestTelegramContact();
  if (!shared) return null;

  if (shared.response) {
    try {
      const { phone } = await apiPost<VerifyContactResponse>("/profile/contact", {
        response: shared.response
      });
      return phone;
    } catch {
      // Верификация не удалась — номер всё равно пригоден для предзаполнения.
    }
  }

  return shared.unsafePhone;
}
