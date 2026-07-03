import { HttpError } from "./errors";

/** Мягкий антиспам-лимит на заявки/обратную связь: не более N обращений за окно. */
export const RATE_LIMIT_MAX = 5;
export const RATE_LIMIT_WINDOW_MINUTES = 10;

/** Бросает 429, если счётчик обращений пользователя за окно уже достиг лимита. */
export function assertUnderLimit(count: number): void {
  if (count >= RATE_LIMIT_MAX) {
    throw new HttpError(429, "Слишком много обращений — попробуйте через несколько минут");
  }
}
