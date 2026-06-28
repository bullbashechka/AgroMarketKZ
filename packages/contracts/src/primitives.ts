import { z } from "zod";
import { NAME_MAX } from "./constants";

/** Обязательное текстовое поле: тримится, не пустое, не длиннее `max`. */
export const requiredText = (max: number, error: string) =>
  z
    .string({ error })
    .trim()
    .min(1, { error })
    .max(max, { error: `Слишком длинно — не более ${max} символов` });

/** Необязательное текстовое поле: тримится, пустая строка превращается в undefined. */
export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, { error: `Слишком длинно — не более ${max} символов` })
    .optional()
    .transform((value) => (value && value.length > 0 ? value : undefined));

/** Имя контакта (регистрация, профиль, заявка, обратная связь). */
export const contactNameSchema = requiredText(NAME_MAX, "Укажите имя");
