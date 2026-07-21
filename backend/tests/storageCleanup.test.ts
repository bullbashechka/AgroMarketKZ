import { describe, expect, test } from "bun:test";
import {
  CLEANUP_GRACE_PERIOD_DAYS,
  isCardImagePath,
  isPastGracePeriod,
  selectOrphanCandidates
} from "../src/lib/storageCleanup";

const VALID_PATH = "cards/11111111-1111-4111-8111-111111111111.webp";

describe("isCardImagePath", () => {
  test("принимает валидный путь для каждого допустимого расширения", () => {
    expect(isCardImagePath("cards/11111111-1111-4111-8111-111111111111.jpg")).toBe(true);
    expect(isCardImagePath("cards/11111111-1111-4111-8111-111111111111.png")).toBe(true);
    expect(isCardImagePath(VALID_PATH)).toBe(true);
  });

  test("отклоняет недопустимое расширение", () => {
    expect(isCardImagePath("cards/11111111-1111-4111-8111-111111111111.gif")).toBe(false);
  });

  test("отклоняет отсутствие префикса cards/", () => {
    expect(isCardImagePath("11111111-1111-4111-8111-111111111111.webp")).toBe(false);
  });

  test("отклоняет вложенные папки", () => {
    expect(isCardImagePath("cards/sub/11111111-1111-4111-8111-111111111111.webp")).toBe(false);
  });

  test("отклоняет имя, не являющееся UUID", () => {
    expect(isCardImagePath("cards/not-a-uuid.webp")).toBe(false);
  });
});

describe("isPastGracePeriod", () => {
  test("объект младше окна не считается прошедшим grace period", () => {
    const now = new Date("2026-01-08T00:00:00Z");
    const createdAt = new Date("2026-01-02T00:00:00Z"); // 6 суток назад
    expect(isPastGracePeriod(createdAt, now)).toBe(false);
  });

  test("объект ровно на границе окна считается прошедшим grace period", () => {
    const now = new Date("2026-01-08T00:00:00Z");
    const createdAt = new Date(now.getTime() - CLEANUP_GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000);
    expect(isPastGracePeriod(createdAt, now)).toBe(true);
  });

  test("объект старше окна считается прошедшим grace period", () => {
    const now = new Date("2026-01-08T00:00:00Z");
    const createdAt = new Date("2025-12-01T00:00:00Z");
    expect(isPastGracePeriod(createdAt, now)).toBe(true);
  });
});

describe("selectOrphanCandidates", () => {
  const now = new Date("2026-01-08T00:00:00Z");
  const old = new Date("2025-12-01T00:00:00Z");
  const recent = new Date("2026-01-07T00:00:00Z");

  test("referenced путь исключается, даже если старый", () => {
    const path = "cards/11111111-1111-4111-8111-111111111111.webp";
    const result = selectOrphanCandidates([{ storagePath: path, createdAt: old }], new Set([path]), now);
    expect(result.candidates).toEqual([]);
    expect(result.skippedInvalidPath).toEqual([]);
    expect(result.skippedTooRecent).toEqual([]);
  });

  test("unreferenced, но моложе grace period — пропускается, а не удаляется", () => {
    const path = "cards/22222222-2222-4222-8222-222222222222.webp";
    const result = selectOrphanCandidates([{ storagePath: path, createdAt: recent }], new Set(), now);
    expect(result.candidates).toEqual([]);
    expect(result.skippedTooRecent).toEqual([path]);
  });

  test("unreferenced и старше grace period — кандидат на удаление", () => {
    const path = "cards/33333333-3333-4333-8333-333333333333.webp";
    const result = selectOrphanCandidates([{ storagePath: path, createdAt: old }], new Set(), now);
    expect(result.candidates).toEqual([path]);
  });

  test("невалидный путь исключается независимо от возраста или ссылки", () => {
    const path = "cards/not-a-uuid.webp";
    const result = selectOrphanCandidates([{ storagePath: path, createdAt: old }], new Set(), now);
    expect(result.candidates).toEqual([]);
    expect(result.skippedInvalidPath).toEqual([path]);
    expect(result.skippedTooRecent).toEqual([]);
  });
});
