import { describe, expect, test } from "bun:test";
import type { AppEnv } from "../src/env";
import { issueToken, verifyToken } from "../src/lib/jwt";

const env = { JWT_SECRET: "test-secret" } as AppEnv;

describe("jwt", () => {
  test("issueToken → verifyToken возвращает те же данные", async () => {
    const token = await issueToken(env, "user-uuid-1", 777);
    const claims = await verifyToken(env, token);
    expect(claims).toEqual({ userId: "user-uuid-1", telegramId: 777 });
  });

  test("verifyToken отклоняет мусор", async () => {
    await expect(verifyToken(env, "not.a.token")).rejects.toThrow();
  });

  test("verifyToken отклоняет токен, подписанный другим секретом", async () => {
    const token = await issueToken({ JWT_SECRET: "other" } as AppEnv, "user-uuid-1", 777);
    await expect(verifyToken(env, token)).rejects.toThrow();
  });
});
