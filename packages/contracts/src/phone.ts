import { z } from "zod";

/**
 * Приводит телефонный номер к единому международному виду E.164 (`+`+код страны+номер).
 * Принимает разный пользовательский ввод: с `+` — любой международный номер; без `+` —
 * трактуется как привычный казахстанский/российский ввод (`8…`, 10 цифр без кода страны),
 * т.к. основная аудитория вводит номера именно так. Возвращает нормализованный номер
 * либо `null`, если строка не сводится к валидному E.164 (код страны 1-9, всего 8-15 цифр).
 */
export function normalizePhone(input: string): string | null {
  const trimmed = input.trim();

  if (trimmed.startsWith("+")) {
    const digits = trimmed.slice(1).replace(/\D/g, "");
    return /^[1-9]\d{7,14}$/.test(digits) ? "+" + digits : null;
  }

  let digits = trimmed.replace(/\D/g, "");

  // 8XXXXXXXXXX → 7XXXXXXXXXX (привычный для KZ/РФ ввод через 8)
  if (digits.length === 11 && digits.startsWith("8")) {
    digits = "7" + digits.slice(1);
  }

  // 10 цифр без кода страны (например, 701 234 56 78) → добавляем код 7
  if (digits.length === 10) {
    digits = "7" + digits;
  }

  return /^[1-9]\d{7,14}$/.test(digits) ? "+" + digits : null;
}

/**
 * Zod-схема телефона: тримит, нормализует к E.164 (`+`+код страны+номер), отклоняет то,
 * что не сводится к валидному международному номеру. Выходной тип — нормализованная строка.
 */
export const phoneSchema = z
  .string({ error: "Укажите номер телефона" })
  .trim()
  .transform((value) => normalizePhone(value))
  .refine((value): value is string => value !== null, {
    error: "Введите номер в международном формате, например +7 701 234 56 78"
  });
