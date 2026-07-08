import { describe, expect, test } from "bun:test";
import { normalizePhone, phoneSchema } from "../src/phone";

describe("normalizePhone", () => {
  test("приводит разные форматы KZ/РФ-ввода без + к +7XXXXXXXXXX", () => {
    expect(normalizePhone("+77011234567")).toBe("+77011234567");
    expect(normalizePhone("87011234567")).toBe("+77011234567");
    expect(normalizePhone("8 (701) 123-45-67")).toBe("+77011234567");
    expect(normalizePhone("7011234567")).toBe("+77011234567"); // 10 цифр без кода
    expect(normalizePhone("+7 701 234 56 78")).toBe("+77012345678");
  });

  test("принимает любой казахстанский/российский код на 7 (без строгой фильтрации операторов)", () => {
    expect(normalizePhone("+7 747 123 45 67")).toBe("+77471234567");
    expect(normalizePhone("+7 912 345 67 89")).toBe("+79123456789"); // ранее отклонялся как РФ
    expect(normalizePhone("+7 495 123 45 67")).toBe("+74951234567"); // ранее отклонялся как стационарный
  });

  test("принимает международные номера с +", () => {
    expect(normalizePhone("+994 50 123 45 67")).toBe("+994501234567"); // Азербайджан
    expect(normalizePhone("+1 415 555 0123")).toBe("+14155550123"); // США
    expect(normalizePhone("+44 20 7946 0958")).toBe("+442079460958"); // Великобритания
  });

  test("отклоняет некорректный ввод", () => {
    expect(normalizePhone("12345")).toBeNull(); // слишком коротко
    expect(normalizePhone("звоните после 18")).toBeNull();
    expect(normalizePhone("")).toBeNull();
    expect(normalizePhone("+0 123 456 789")).toBeNull(); // код страны не может начинаться с 0
    expect(normalizePhone("+1234567890123456")).toBeNull(); // больше 15 цифр
  });

  test("идемпотентно на уже нормализованном значении", () => {
    const normalized = normalizePhone("8 701 123 45 67");
    expect(normalized).not.toBeNull();
    expect(normalizePhone(normalized as string)).toBe(normalized);
  });
});

describe("phoneSchema", () => {
  test("парсит и нормализует валидный номер", () => {
    expect(phoneSchema.parse("8 701 123 45 67")).toBe("+77011234567");
  });

  test("парсит международный номер", () => {
    expect(phoneSchema.parse("+994 50 123 45 67")).toBe("+994501234567");
  });

  test("возвращает ошибку на мусоре", () => {
    const result = phoneSchema.safeParse("не телефон");
    expect(result.success).toBe(false);
  });
});
