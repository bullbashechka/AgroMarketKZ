import { describe, expect, test } from "bun:test";
import { resolveEnv } from "../src/env";

describe("resolveEnv", () => {
  test("rejects an unknown AUTH_CACHE_MODE before runtime cache selection", () => {
    expect(() => resolveEnv(undefined, { AUTH_CACHE_MODE: "disable" })).toThrow(
      "AUTH_CACHE_MODE must be disabled or read-through",
    );
  });

  test.each(["disabled", "read-through"])("accepts supported AUTH_CACHE_MODE %s", (mode) => {
    expect(resolveEnv(undefined, { AUTH_CACHE_MODE: mode }).AUTH_CACHE_MODE).toBe(mode);
  });
});
