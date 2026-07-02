import { describe, expect, test } from "bun:test";
import { paginateRows } from "../src/lib/pagination";

describe("paginateRows", () => {
  test("меньше строк, чем limit — hasMore false, nextOffset null", () => {
    const result = paginateRows([1, 2], 5, 0);
    expect(result).toEqual({ items: [1, 2], hasMore: false, nextOffset: null });
  });

  test("ровно limit строк — hasMore false (нет лишней строки-маркера)", () => {
    const result = paginateRows([1, 2, 3], 3, 0);
    expect(result).toEqual({ items: [1, 2, 3], hasMore: false, nextOffset: null });
  });

  test("limit+1 строк — hasMore true, лишняя строка отброшена, nextOffset = offset+limit", () => {
    const result = paginateRows([1, 2, 3], 2, 0);
    expect(result).toEqual({ items: [1, 2], hasMore: true, nextOffset: 2 });
  });

  test("учитывает ненулевой offset при вычислении nextOffset", () => {
    const result = paginateRows([1, 2, 3], 2, 10);
    expect(result).toEqual({ items: [1, 2], hasMore: true, nextOffset: 12 });
  });

  test("пустой список", () => {
    const result = paginateRows([], 5, 0);
    expect(result).toEqual({ items: [], hasMore: false, nextOffset: null });
  });
});
