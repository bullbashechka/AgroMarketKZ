import { describe, expect, test } from "bun:test";
import type { Profile } from "@agromarket/contracts";
import { ApiError } from "../src/lib/api";
import { classifyAuthStatus } from "../src/lib/auth";

describe("auth response boundary recovery", () => {
  test("does not treat a cached profile as ready after a malformed refetch", () => {
    const cachedProfile = {} as Profile;
    const malformedResponse = new ApiError(
      502,
      "Сервер вернул некорректные данные. Повторите попытку позже.",
      undefined,
      "INVALID_API_RESPONSE",
    );

    expect(classifyAuthStatus({
      profile: cachedProfile,
      error: malformedResponse,
      isLoading: false,
      isError: true,
    })).toBe("error");
  });
});
