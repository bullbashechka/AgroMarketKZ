import { describe, expect, test } from "bun:test";
import { getLivePublicationIssues, type LivePublicationInput } from "../src/lib/publicationChecklist";

const complete: LivePublicationInput = {
  title: "Пшеница",
  categoryId: "00000000-0000-4000-8000-000000000001",
  categoryState: "ready",
  categoryFound: true,
  requiredSpecs: ["Год выпуска"],
  type: "product",
  description: "Описание",
  priceType: "fixed",
  priceAmount: 1000,
  priceUnit: "за тонну",
  priceReason: null,
  territoryCode: "abay_region",
  ownershipForm: "peasant_farm",
  productLocation: "elevator",
  serviceAllKazakhstan: false,
  serviceTerritoryCount: 0,
  availability: "В наличии",
  imageCount: 1,
  imagePending: false,
  imageError: false,
  specs: [{ key: "Год выпуска", value: "2026" }],
};

describe("getLivePublicationIssues", () => {
  test("matches the server publication rules for a complete card", () => {
    expect(getLivePublicationIssues(complete)).toEqual([]);
  });

  test("blocks unresolved title, category, and category requirements", () => {
    const issues = getLivePublicationIssues({
      ...complete,
      title: "  ",
      categoryId: "",
      requiredSpecs: ["Год выпуска", "Белок"],
      specs: [{ key: "Год выпуска", value: "2026" }],
    });

    expect(issues).toEqual(expect.arrayContaining([
      "Укажите название",
      "Выберите категорию",
      "Заполните характеристику «Белок»",
    ]));
  });

  test.each([
    ["loading", "Проверяем требования категории"],
    ["error", "Не удалось проверить требования категории"],
  ] as const)("does not report a false green state while category query is %s", (categoryState, issue) => {
    expect(getLivePublicationIssues({ ...complete, categoryState })).toContain(issue);
  });
});
