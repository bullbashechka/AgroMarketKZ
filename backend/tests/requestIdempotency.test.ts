import { describe, expect, test } from "bun:test";
import type { CreateRequestInput } from "@agromarket/contracts";
import { requestPayloadHash } from "../src/lib/requestIdempotency";
import { assertUnderLimit, RATE_LIMIT_MAX } from "../src/lib/rateLimit";
import { HttpError } from "../src/lib/errors";

const base: CreateRequestInput = {
  source: "profile",
  clientRequestId: "11111111-1111-4111-8111-111111111111",
  contactName: "Айбек",
  contactPhone: "+77011234567",
  comment: "Позвонить вечером",
};

describe("requestPayloadHash", () => {
  test("не зависит от id попытки и Telegram proof", async () => {
    const a = await requestPayloadHash(base);
    const b = await requestPayloadHash({
      ...base,
      clientRequestId: "22222222-2222-4222-8222-222222222222",
      contactResponse: "other-proof",
    });
    expect(a).toBe(b);
  });

  test("меняется при изменении пользовательского содержимого", async () => {
    expect(await requestPayloadHash(base)).not.toBe(
      await requestPayloadHash({ ...base, comment: "Позвонить утром" }),
    );
  });

  test("считает одинаковым набор регионов услуги в разном порядке", async () => {
    const first: CreateRequestInput = {
      ...base,
      source: "tab",
      tabType: "service",
      listingSubmission: {
        type: "service",
        categoryId: "11111111-1111-4111-8111-111111111112",
        allKazakhstan: false,
        territoryCodes: ["almaty_region", "astana_city"]
      }
    };
    const second: CreateRequestInput = {
      ...first,
      listingSubmission: { ...first.listingSubmission, territoryCodes: ["astana_city", "almaty_region"] }
    };
    expect(await requestPayloadHash(first)).toBe(await requestPayloadHash(second));
  });
});

test("rate limit сохраняет точный retryAfterSeconds в машинном поле", () => {
  try {
    assertUnderLimit(RATE_LIMIT_MAX, 125);
    throw new Error("ожидалась ошибка");
  } catch (error) {
    expect(error).toBeInstanceOf(HttpError);
    expect((error as HttpError).details.retryAfterSeconds).toBe(125);
    expect((error as Error).message).toContain("3 мин");
  }
});
