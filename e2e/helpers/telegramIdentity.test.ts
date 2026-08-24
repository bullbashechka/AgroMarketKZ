import { describe, expect, test } from "bun:test";
import { resolveE2ERunId, telegramIdFor } from "./telegramIdentity";

describe("E2E Telegram identities", () => {
  test("keeps explicit run ids unchanged and rejects lossy values", () => {
    expect(resolveE2ERunId("run-20260824")).toBe("run-20260824");
    expect(() => resolveE2ERunId("run_20260824")).toThrow("only 1-32");
    expect(() => resolveE2ERunId("a".repeat(33))).toThrow("only 1-32");
    expect(() => resolveE2ERunId("run!20260824")).toThrow("only 1-32");
  });

  test("derives repeatable isolated ids in the safe Telegram range", () => {
    const first = telegramIdFor("run-20260824", "test:admin-requests-status");
    expect(first).toBe(telegramIdFor("run-20260824", "test:admin-requests-status"));
    expect(first).not.toBe(telegramIdFor("run-20260824", "fixture:fresh-user"));
    expect(first).toBeGreaterThanOrEqual(900_000_000_000);
    expect(first).toBeLessThan(999_000_000_000);
  });
});

