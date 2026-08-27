import { afterEach, describe, expect, test } from "bun:test";
import { authResponse, profileSchema } from "@agromarket/contracts";
import { ApiError, apiGetParsed, apiPostParsed } from "../src/lib/api";

const realFetch = globalThis.fetch;

const profile = {
  id: "11111111-1111-4111-8111-111111111111",
  telegramId: 123,
  telegramUsername: null,
  telegramFirstName: "Тест",
  telegramLastName: null,
  contactName: null,
  contactPhone: null,
  phoneVerified: false,
  isRegistered: false,
  registeredAt: null,
  isAdmin: false,
  createdAt: "2026-01-01T00:00:00.000Z",
};

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("schema-aware API boundary", () => {
  test("accepts a valid additive auth response", async () => {
    globalThis.fetch = (async () => Response.json({
      profile,
      futureBackendField: "ignored for forward compatibility",
    })) as typeof fetch;

    await expect(apiPostParsed("/auth/widget/exchange", {}, authResponse)).resolves.toEqual({ profile });
  });

  test("turns malformed successful payload into safe boundary error", async () => {
    globalThis.fetch = (async () => Response.json({ ...profile, telegramId: "not-a-number" })) as typeof fetch;

    await expect(apiGetParsed("/profile", profileSchema)).rejects.toMatchObject({
      status: 502,
      code: "INVALID_API_RESPONSE",
      message: "Сервер вернул некорректные данные. Повторите попытку позже.",
    });
  });

  test("uses only validated stable API error metadata", async () => {
    globalThis.fetch = (async () => Response.json({
      error: "Попробуйте позже",
      code: "RATE_LIMITED",
      retryAfterSeconds: 30,
      retryable: true,
      unexpected: { private: "must not reach the error" },
    }, { status: 429 })) as typeof fetch;

    await expect(apiGetParsed("/profile", profileSchema)).rejects.toMatchObject({
      status: 429,
      message: "Попробуйте позже",
      code: "RATE_LIMITED",
      retryAfterSeconds: 30,
      retryable: true,
    } satisfies Partial<ApiError>);
  });
});
