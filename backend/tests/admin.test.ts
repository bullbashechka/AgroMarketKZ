import { describe, expect, spyOn, test } from "bun:test";
import type { AppEnv } from "../src/env";
import { isAdmin, parseAllowlist } from "../src/lib/admin";
import { MAX_TELEGRAM_ID } from "../src/lib/telegramId";

const mk = (allowlist: string) => ({ ADMIN_ALLOWLIST: allowlist }) as AppEnv;

describe("admin allowlist", () => {
  test("парсит числовые id, игнорирует username", () => {
    const ids = parseAllowlist(mk("7701, @aidos_unique, 8801, kanat_unique"));
    expect(ids.has(7701)).toBe(true);
    expect(ids.has(8801)).toBe(true);
    expect(ids.size).toBe(2);
  });

  test("isAdmin матчит строго по id", () => {
    const env = mk("7702,8802");
    expect(isAdmin(7702, env)).toBe(true);
    expect(isAdmin(123, env)).toBe(false);
  });

  test("пустой/неуказанный список — никто не админ", () => {
    expect(isAdmin(777, mk("empty_unique"))).toBe(false);
    expect(isAdmin(777, {} as AppEnv)).toBe(false);
  });

  test("отбраковывает id вне допустимого диапазона", () => {
    const ids = parseAllowlist(mk(`7703,${MAX_TELEGRAM_ID + 1},0,-1`));
    expect([...ids]).toEqual([7703]);
  });

  test("пропускает синтетический 12-значный id", () => {
    expect(parseAllowlist(mk("999000000103")).has(999000000103)).toBe(true);
  });

  test("ведущие нули не создают алиас существующего админа", () => {
    const ids = parseAllowlist(mk("0777,7704"));
    expect(ids.has(777)).toBe(false);
    expect(ids.has(7704)).toBe(true);
  });

  test("принимает 2^52 и отбраковывает 2^52 + 1", () => {
    const ids = parseAllowlist(mk(`${MAX_TELEGRAM_ID},${MAX_TELEGRAM_ID + 1},7705`));
    expect(ids.has(MAX_TELEGRAM_ID)).toBe(true);
    expect(ids.has(MAX_TELEGRAM_ID + 1)).toBe(false);
  });

  test("предупреждает только один раз при повторном вызове с той же строкой", () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    const env = mk("invalid_repeat_unique");

    parseAllowlist(env);
    parseAllowlist(env);

    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  test("смена строки пересчитывает кеш", () => {
    const first = parseAllowlist(mk("7706"));
    const second = parseAllowlist(mk("7707"));

    expect(first.has(7706)).toBe(true);
    expect(second.has(7706)).toBe(false);
    expect(second.has(7707)).toBe(true);
  });

  test("предупреждает при пустом списке", () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});

    parseAllowlist(mk("   "));

    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain("админка недоступна");
    warn.mockRestore();
  });

  test("предупреждает при синтетическом id", () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});

    parseAllowlist(mk("999000000108"));

    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain("синтетические");
    warn.mockRestore();
  });
});
