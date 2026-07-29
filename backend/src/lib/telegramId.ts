export const MAX_TELEGRAM_ID = 2 ** 52;
export const SYNTHETIC_TELEGRAM_ID_MIN = 999_000_000_000;

export function isPlausibleTelegramId(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value > 0 &&
    value <= MAX_TELEGRAM_ID
  );
}

export function parseTelegramIdToken(token: string): number | null {
  if (!/^[1-9]\d{0,15}$/.test(token)) return null;
  const id = Number(token);
  return isPlausibleTelegramId(id) ? id : null;
}

export function looksSyntheticTelegramId(id: number): boolean {
  return isPlausibleTelegramId(id) && id >= SYNTHETIC_TELEGRAM_ID_MIN;
}
