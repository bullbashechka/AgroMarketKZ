import { describe, expect, test } from "bun:test";
import { deriveSessionRotationToken } from "../src/lib/session";

describe("session rotation token recovery", () => {
  test("is deterministic for one source token and server secret", async () => {
    const token = "source-session-token";
    const secret = "integration-only-bot-token";

    const first = await deriveSessionRotationToken(token, secret);
    const second = await deriveSessionRotationToken(token, secret);

    expect(first).toBe(second);
    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await deriveSessionRotationToken("another-token", secret)).not.toBe(first);
    expect(await deriveSessionRotationToken(token, "another-secret")).not.toBe(first);
  });
});
