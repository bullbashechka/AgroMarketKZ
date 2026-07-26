import { beforeEach, describe, expect, test } from "bun:test";
import {
  MAX_AUTO_RETRIES,
  RETRY_JITTER_SECONDS,
  autoRetriesLeft,
  computeRetryDelaySeconds,
  consumeAutoRetry,
  resetAutoRetries,
} from "../src/lib/rateLimitRetry";

beforeEach(() => {
  resetAutoRetries();
});

describe("rate limit auto retry budget", () => {
  test("расходует не больше трёх автоматических попыток", () => {
    expect(autoRetriesLeft()).toBe(MAX_AUTO_RETRIES);

    for (let index = 0; index < MAX_AUTO_RETRIES + 2; index += 1) {
      consumeAutoRetry();
    }

    expect(autoRetriesLeft()).toBe(0);
  });

  test("успешная загрузка сбрасывает бюджет", () => {
    consumeAutoRetry();
    consumeAutoRetry();
    resetAutoRetries();

    expect(autoRetriesLeft()).toBe(MAX_AUTO_RETRIES);
  });
});

describe("computeRetryDelaySeconds", () => {
  test("использует 60 секунд по умолчанию и детерминированный jitter", () => {
    expect(computeRetryDelaySeconds(null, () => 0)).toBe(60);
    expect(computeRetryDelaySeconds(null, () => 0.999)).toBe(60 + RETRY_JITTER_SECONDS);
  });

  test("зажимает Retry-After в диапазон 1–300 секунд", () => {
    expect(computeRetryDelaySeconds(0, () => 0)).toBe(1);
    expect(computeRetryDelaySeconds(86_400, () => 0)).toBe(300);
  });
});
