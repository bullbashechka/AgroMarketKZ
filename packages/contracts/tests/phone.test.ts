import { describe, expect, test } from "bun:test";
import { kzPhoneSchema, normalizeKzPhone } from "../src/phone";

describe("normalizeKzPhone", () => {
  test("приводит разные форматы к +7XXXXXXXXXX", () => {
    expect(normalizeKzPhone("+77011234567")).toBe("+77011234567");
    expect(normalizeKzPhone("87011234567")).toBe("+77011234567");
    expect(normalizeKzPhone("8 (701) 123-45-67")).toBe("+77011234567");
    expect(normalizeKzPhone("7011234567")).toBe("+77011234567"); // 10 цифр без кода
    expect(normalizeKzPhone("+7 701 234 56 78")).toBe("+77012345678");
  });

  test("отклоняет некорректный ввод", () => {
    expect(normalizeKzPhone("12345")).toBeNull();
    expect(normalizeKzPhone("звоните после 18")).toBeNull();
    expect(normalizeKzPhone("+1 202 555 0100")).toBeNull(); // не +7
    expect(normalizeKzPhone("")).toBeNull();
  });
});

describe("kzPhoneSchema", () => {
  test("парсит и нормализует валидный номер", () => {
    expect(kzPhoneSchema.parse("8 701 123 45 67")).toBe("+77011234567");
  });

  test("возвращает ошибку на мусоре", () => {
    const result = kzPhoneSchema.safeParse("не телефон");
    expect(result.success).toBe(false);
  });
});
