import { describe, expect, test } from "bun:test";
import { escapeLike, normalizeCatalogText } from "../src/lib/search";

describe("escapeLike", () => {
  test("обычная строка не меняется", () => {
    expect(escapeLike("трактор")).toBe("трактор");
  });

  test("экранирует %", () => {
    expect(escapeLike("скидка 100%")).toBe("скидка 100\\%");
  });

  test("экранирует _", () => {
    expect(escapeLike("a_b")).toBe("a\\_b");
  });

  test("экранирует обратный слэш раньше остальных спецсимволов", () => {
    expect(escapeLike("a\\b")).toBe("a\\\\b");
  });

  test("комбинация спецсимволов", () => {
    expect(escapeLike("50%_off\\now")).toBe("50\\%\\_off\\\\now");
  });

  test("пустая строка", () => {
    expect(escapeLike("")).toBe("");
  });
});

describe("normalizeCatalogText", () => {
  test("исправляет масляничные и сохраняет корректное написание", () => {
    expect(normalizeCatalogText("Масляничные культуры")).toBe("Масличные культуры");
    expect(normalizeCatalogText("масличные культуры")).toBe("масличные культуры");
  });
});
