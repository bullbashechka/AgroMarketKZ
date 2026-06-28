import { z } from "zod";

/**
 * Приводит телефонный номер к единому казахстанскому виду `+7XXXXXXXXXX` (11 цифр).
 * Принимает разный пользовательский ввод: `8…`, `+7…`, `7…`, со скобками, пробелами и дефисами.
 * Возвращает нормализованный номер либо `null`, если это не похоже на номер +7.
 */
export function normalizeKzPhone(input: string): string | null {
  let digits = input.replace(/\D/g, "");

  // 8XXXXXXXXXX → 7XXXXXXXXXX (привычный для KZ/РФ ввод через 8)
  if (digits.length === 11 && digits.startsWith("8")) {
    digits = "7" + digits.slice(1);
  }

  // 10 цифр без кода страны (например, 701 234 56 78) → добавляем код 7
  if (digits.length === 10) {
    digits = "7" + digits;
  }

  if (!/^7\d{10}$/.test(digits)) {
    return null;
  }

  return "+" + digits;
}

/**
 * Zod-схема телефона: тримит, нормализует к `+7XXXXXXXXXX`, отклоняет всё, что не сводится
 * к казахстанскому номеру. Выходной тип — нормализованная строка.
 */
export const kzPhoneSchema = z
  .string({ error: "Укажите номер телефона" })
  .trim()
  .transform((value) => normalizeKzPhone(value))
  .refine((value): value is string => value !== null, {
    error: "Введите корректный номер телефона Казахстана (например, +7 701 234 56 78)"
  });
