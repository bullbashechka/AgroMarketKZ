import { describe, expect, test } from "bun:test";
import { catalogSearchSchema, productCatalogSearchSchema } from "../src/lib/searchParams";

describe("catalog search params — география", () => {
  test("товар сохраняет область и отбрасывает города", () => {
    expect(productCatalogSearchSchema({ region: "kostanay_region" }).region).toBe("kostanay_region");
    expect(productCatalogSearchSchema({ region: "almaty_city" }).region).toBeUndefined();
    expect(productCatalogSearchSchema({ region: "republican_cities" }).region).toBeUndefined();
  });

  test("услуга сохраняет фильтр городов республиканского значения", () => {
    expect(catalogSearchSchema({ region: "republican_cities" }).region).toBe("republican_cities");
  });
});
