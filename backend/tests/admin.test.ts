import { describe, expect, test } from "bun:test";
import type { AppEnv } from "../src/env";
import { isAdmin, parseAllowlist } from "../src/lib/admin";

const mk = (allowlist: string) => ({ ADMIN_ALLOWLIST: allowlist }) as AppEnv;

describe("admin allowlist", () => {
  test("парсит числовые id, игнорирует username", () => {
    const ids = parseAllowlist(mk("777, @aidos, 888, kanat"));
    expect(ids.has(777)).toBe(true);
    expect(ids.has(888)).toBe(true);
    expect(ids.size).toBe(2);
  });

  test("isAdmin матчит строго по id", () => {
    const env = mk("777,888");
    expect(isAdmin(777, env)).toBe(true);
    expect(isAdmin(123, env)).toBe(false);
  });

  test("пустой/неуказанный список — никто не админ", () => {
    expect(isAdmin(777, mk(""))).toBe(false);
    expect(isAdmin(777, {} as AppEnv)).toBe(false);
  });
});
