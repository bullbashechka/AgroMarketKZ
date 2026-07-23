import { describe, expect, test } from "bun:test";
import { telegramContactSchema } from "../src/telegramContact";

describe("telegramContactSchema", () => {
  test("принимает @handle, канонизирует в https://t.me/<handle>", () => {
    expect(telegramContactSchema.parse("@some_handle")).toBe("https://t.me/some_handle");
  });

  test("принимает handle без @", () => {
    expect(telegramContactSchema.parse("some_handle")).toBe("https://t.me/some_handle");
  });

  test("принимает t.me/handle без схемы", () => {
    expect(telegramContactSchema.parse("t.me/some_handle")).toBe("https://t.me/some_handle");
  });

  test("принимает https://t.me/handle в разном регистре хоста", () => {
    expect(telegramContactSchema.parse("https://T.Me/Some_Handle")).toBe("https://t.me/Some_Handle");
  });

  test("отклоняет http:// (не https)", () => {
    expect(telegramContactSchema.safeParse("http://t.me/some_handle").success).toBe(false);
  });

  test("отклоняет ссылки на чужой хост", () => {
    expect(telegramContactSchema.safeParse("https://evil.com/some_handle").success).toBe(false);
  });

  test("отклоняет слишком короткий handle", () => {
    expect(telegramContactSchema.safeParse("@ab").success).toBe(false);
  });

  test("отклоняет мусор", () => {
    expect(telegramContactSchema.safeParse("не телеграм").success).toBe(false);
  });
});
