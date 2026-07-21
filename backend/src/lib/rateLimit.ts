import { HttpError } from "./errors";

/** Мягкий антиспам-лимит на заявки/обратную связь: не более N обращений за окно. */
export const RATE_LIMIT_MAX = 5;
export const RATE_LIMIT_WINDOW_MINUTES = 10;

/** Бросает 429, если счётчик обращений пользователя за окно уже достиг лимита. */
export function assertUnderLimit(count: number, retryAfterSeconds = 0): void {
  if (count >= RATE_LIMIT_MAX) {
    const minutes = Math.max(1, Math.ceil(retryAfterSeconds / 60));
    throw new HttpError(
      429,
      `Слишком много обращений — повторите через ${minutes} мин.`,
      { retryAfterSeconds },
    );
  }
}

/** Секунд до истечения окна лимита, если известно время самого старого обращения в нём. */
export function retryAfterSeconds(oldest: Date | null): number {
  if (!oldest) return 0;
  return Math.max(1, Math.ceil((oldest.getTime() + RATE_LIMIT_WINDOW_MINUTES * 60_000 - Date.now()) / 1000));
}
