import { describe, expect, test } from "bun:test";
import { getPublicationIssues, getPublicationStatus } from "@agromarket/contracts";

const complete = {
  description: "Подробное описание",
  priceType: "from" as const,
  priceAmount: 90_000,
  priceUnit: "за тонну",
  priceReason: "Зависит от объёма",
  location: "Костанайская область",
  availability: "В наличии",
  imageCount: 1,
  specs: [
    { key: " Год выпуска ", value: "2022" },
    { key: "Состояние", value: "После ТО" },
  ],
  requiredSpecs: ["год выпуска", "Состояние"],
};

describe("getPublicationIssues", () => {
  test("полная карточка проходит проверку, обязательные ключи сравниваются без регистра и пробелов", () => {
    expect(getPublicationIssues(complete)).toEqual([]);
  });

  test("требует точные данные товара и географию услуги", () => {
    expect(getPublicationIssues({
      ...complete,
      type: "product",
      territoryCode: null,
      ownershipForm: null,
      productLocation: null,
      serviceAllKazakhstan: false,
      serviceTerritoryCount: 0
    })).toEqual(expect.arrayContaining([
      "Выберите регион",
      "Выберите форму собственности",
      "Выберите местонахождение"
    ]));
    expect(getPublicationIssues({
      ...complete,
      type: "service",
      territoryCode: null,
      ownershipForm: null,
      productLocation: null,
      serviceAllKazakhstan: false,
      serviceTerritoryCount: 0
    })).toContain("Выберите хотя бы один регион или весь Казахстан");
  });

  test("возвращает все причины, мешающие публикации", () => {
    const issues = getPublicationIssues({
      ...complete,
      description: " ",
      priceType: "on_request",
      priceAmount: null,
      priceUnit: null,
      priceReason: null,
      location: null,
      availability: null,
      imageCount: 0,
      specs: [],
    });
    expect(issues).toContain("Добавьте описание");
    expect(issues).toContain("Добавьте хотя бы одно фото");
    expect(issues).toContain("Укажите регион или территорию");
    expect(issues).toContain("Укажите наличие или срок исполнения");
    expect(issues).toContain("Укажите единицу цены");
    expect(issues).toContain("Объясните, от чего зависит цена");
    expect(issues).toContain("Заполните характеристику «год выпуска»");
  });

  test("товарная категория требует группу, объём и цену, но не наличие", () => {
    const product = {
      ...complete,
      type: "product" as const,
      territoryCode: "kostanay_region",
      ownershipForm: "peasant_farm" as const,
      productLocation: "elevator" as const,
      categoryIsCommodity: true,
      commodityGroup: "cereals" as const,
      volumeTonnes: 120.5,
      availability: null,
      priceType: "fixed" as const,
      priceAmount: 100_000,
      priceUnit: "за тонну",
      priceReason: null,
    };
    expect(getPublicationIssues(product)).toEqual([]);
    expect(getPublicationIssues({ ...product, commodityGroup: null })).toContain("Выберите группу продукции");
    expect(getPublicationIssues({ ...product, volumeTonnes: null })).toContain("Укажите объём в тоннах");
    expect(getPublicationIssues({ ...product, priceType: "on_request", priceAmount: null, priceReason: "По договорённости" })).toContain("У товара всегда должна быть цена");
  });
});

describe("getPublicationStatus", () => {
  test("различает черновик, опубликованную и скрытую карточку", () => {
    expect(getPublicationStatus(null, null)).toBe("draft");
    expect(getPublicationStatus(new Date(), null)).toBe("published");
    expect(getPublicationStatus(new Date(), new Date())).toBe("archived");
  });
});
