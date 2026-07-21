import { describe, expect, test } from "bun:test";
import { sign } from "hono/jwt";
import type { AppEnv } from "../src/env";
import { issueToken, verifyToken } from "../src/lib/jwt";

const env = { JWT_SECRET: "test-secret" } as AppEnv;
const USER_ID = "45d5fe54-f20b-4fe4-9e22-cad4f7751a47";

describe("jwt", () => {
  test("issueToken → verifyToken возвращает те же данные", async () => {
    const token = await issueToken(env, USER_ID, 777, 3);
    const claims = await verifyToken(env, token);
    expect(claims).toMatchObject({ userId: USER_ID, telegramId: 777, tokenVersion: 3 });
    expect(claims.issuedAt).toBeInteger();
  });

  test("verifyToken отклоняет мусор", async () => {
    await expect(verifyToken(env, "not.a.token")).rejects.toThrow();
  });

  test("verifyToken отклоняет токен, подписанный другим секретом", async () => {
    const token = await issueToken({ JWT_SECRET: "other" } as AppEnv, USER_ID, 777, 0);
    await expect(verifyToken(env, token)).rejects.toThrow();
  });

  test("rejects a signed token with malformed runtime claims", async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = await sign(
      { sub: "not-a-uuid", tgId: 777, ver: -1, iat: now, exp: now + 60 },
      env.JWT_SECRET,
      "HS256",
    );

    await expect(verifyToken(env, token)).rejects.toThrow();
  });

  test("accepts a legacy token as session version zero until its exp", async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = await sign({ sub: USER_ID, tgId: 777, exp: now + 60 }, env.JWT_SECRET, "HS256");

    await expect(verifyToken(env, token)).resolves.toEqual({
      userId: USER_ID,
      telegramId: 777,
      tokenVersion: 0,
      issuedAt: undefined,
    });
  });
});
