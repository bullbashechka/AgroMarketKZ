import { describe, expect, test } from "bun:test";
import { RATE_LIMIT_WINDOW_MINUTES, retryAfterSeconds } from "../src/lib/rateLimit";

describe("retryAfterSeconds", () => {
  test("возвращает 0, если самого старого обращения в окне нет", () => {
    expect(retryAfterSeconds(null)).toBe(0);
  });

  test("для свежего обращения возвращает время до конца окна", () => {
    const oldest = new Date(Date.now() - 60_000); // минуту назад
    const expected = RATE_LIMIT_WINDOW_MINUTES * 60 - 60;
    expect(retryAfterSeconds(oldest)).toBeGreaterThanOrEqual(expected - 1);
    expect(retryAfterSeconds(oldest)).toBeLessThanOrEqual(expected + 1);
  });

  test("не возвращает меньше 1 секунды даже для устаревшего окна", () => {
    const oldest = new Date(Date.now() - 60 * 60_000); // час назад — окно уже истекло
    expect(retryAfterSeconds(oldest)).toBe(1);
  });
});
