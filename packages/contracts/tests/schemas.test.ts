import { describe, expect, test } from "bun:test";
import { createCardInput, publishCardInput } from "../src/card";
import { createRequestInput } from "../src/request";
import { contactNameSchema } from "../src/primitives";
import { createUploadUrlInput } from "../src/upload";
import { adminCardListQuery } from "../src/admin";
import { adminPlatformSettingsSchema } from "../src/settings";
import { cardListQuery, categoryListQuery } from "../src/catalog";
import { VOLUME_MAX, VOLUME_MIN } from "../src/constants";
import { volumeTonnesSchema } from "../src/commodity";
import { updateProfileInput } from "../src/profile";
import { getPublicationPolicyIssues } from "../src/publication";
import { favoriteMembershipQuery, favoritesPageQuery } from "../src/favorite";

const UUID = "11111111-1111-4111-8111-111111111111";
const oneImage = [{ storagePath: `cards/${UUID}.jpg` }];

describe("updateProfileInput — Telegram contact proof", () => {
  test("принимает optional proof только как непустую строку", () => {
    expect(updateProfileInput.safeParse({ contactName: "Айдос", contactPhone: "+77011234567" }).success).toBe(true);
    expect(updateProfileInput.safeParse({ contactName: "Айдос", contactPhone: "+77011234567", contactResponse: "signed-proof" }).success).toBe(true);
    expect(updateProfileInput.safeParse({ contactName: "Айдос", contactPhone: "+77011234567", contactResponse: "" }).success).toBe(false);
  });
});

const baseCard = {
  type: "product" as const,
  categoryId: UUID,
  title: "Пшеница",
  description: "Пшеница третьего класса",
  priceUnit: "за тонну",
  location: "Костанайская область",
  territoryCode: "kostanay_region" as const,
  ownershipForm: "peasant_farm" as const,
  productLocation: "elevator" as const,
  availability: "В наличии",
  images: oneImage,
};

function publicationPolicyPaths(input: unknown): string[] {
  const card = createCardInput.parse(input);
  return getPublicationPolicyIssues({
    type: card.type,
    description: card.description,
    priceType: card.priceType,
    priceAmount: card.priceAmount ?? null,
    priceUnit: card.priceUnit ?? null,
    priceReason: card.priceReason ?? null,
    territoryCode: card.territoryCode ?? null,
    ownershipForm: card.ownershipForm ?? null,
    productLocation: card.productLocation ?? null,
    categoryIsCommodity: false,
    serviceAllKazakhstan: card.serviceAllKazakhstan,
    serviceTerritoryCount: card.serviceTerritoryCodes.length,
    availability: card.availability ?? null,
    imageCount: card.images.length,
    specs: card.specs,
    requiredSpecs: [],
  }).map((issue) => issue.path);
}

describe("createCardInput — цена", () => {
  test("fixed с положительной ценой валиден", () => {
    const r = publishCardInput.safeParse({ ...baseCard, priceType: "fixed", priceAmount: 120000 });
    expect(r.success).toBe(true);
  });

  test("from с ценой и необязательной причиной валиден", () => {
    const r = publishCardInput.safeParse({
      ...baseCard,
      priceType: "from",
      priceAmount: 90000,
      priceReason: "Зависит от объёма",
    });
    expect(r.success).toBe(true);
  });

  test("услуга по запросу требует причину, товар всегда требует сумму", () => {
    expect(
      publishCardInput.safeParse({
        ...baseCard,
        type: "service",
        territoryCode: undefined,
        ownershipForm: undefined,
        productLocation: undefined,
        serviceAllKazakhstan: true,
        serviceTerritoryCodes: [],
        availability: "По согласованию",
        priceType: "on_request",
        priceAmount: null,
        priceReason: "Зависит от региона и объёма",
      }).success,
    ).toBe(true);
    expect(publishCardInput.safeParse({ ...baseCard, priceType: "on_request", priceReason: "Зависит от региона" }).success).toBe(false);
    expect(publishCardInput.safeParse({ ...baseCard, priceType: "on_request" }).success).toBe(false);
  });

  test("fixed без цены — ошибка публикации, но валидный черновик", () => {
    const r = publishCardInput.safeParse({ ...baseCard, priceType: "fixed", priceAmount: null });
    expect(r.success).toBe(false);
    expect(
      createCardInput.safeParse({
        type: "product",
        categoryId: UUID,
        title: "Незавершённая карточка",
        priceType: "fixed",
      }).success,
    ).toBe(true);
  });
});

describe("publishCardInput — единая policy", () => {
  const baseService = {
    type: "service" as const,
    categoryId: UUID,
    title: "Перевозка зерна",
    description: "Перевозка по регионам Казахстана",
    priceType: "on_request" as const,
    priceAmount: null,
    priceUnit: "за рейс",
    priceReason: "Зависит от маршрута",
    availability: "По согласованию",
    images: oneImage,
  };

  test("Zod совпадает с canonical policy по допустимости и путям product/service вариантов", () => {
    const cases = [
      { ...baseCard, priceType: "fixed" as const, priceAmount: 120_000 },
      { ...baseCard, description: " ", priceType: "fixed" as const, priceAmount: 120_000 },
      { ...baseCard, images: [], priceType: "fixed" as const, priceAmount: 120_000 },
      { ...baseCard, priceType: "on_request" as const, priceAmount: null, priceReason: "По договорённости" },
      { ...baseService, serviceAllKazakhstan: true, serviceTerritoryCodes: [] },
      { ...baseService, serviceAllKazakhstan: false, serviceTerritoryCodes: [] },
      { ...baseService, serviceAllKazakhstan: true, serviceTerritoryCodes: [], priceReason: null },
    ];

    for (const input of cases) {
      const parsed = publishCardInput.safeParse(input);
      const policyPaths = publicationPolicyPaths(input);
      expect(parsed.success).toBe(policyPaths.length === 0);
      if (!parsed.success) {
        expect(parsed.error.issues
          .filter((issue) => issue.code === "custom")
          .map((issue) => String(issue.path[0])))
          .toEqual(policyPaths);
      }
    }
  });
});

describe("createCardInput — фото и характеристики", () => {
  test("без фото — ошибка публикации, но черновик сохраняется", () => {
    const payload = {
      ...baseCard,
      images: [],
      priceType: "fixed" as const,
      priceAmount: 120000,
    };
    expect(publishCardInput.safeParse(payload).success).toBe(false);
    expect(createCardInput.safeParse(payload).success).toBe(true);
  });

  test("дублирующиеся ключи характеристик — ошибка", () => {
    const r = createCardInput.safeParse({
      ...baseCard,
      priceType: "fixed",
      priceAmount: 120000,
      specs: [
        { key: "Регион", value: "Алматы" },
        { key: "регион", value: "Астана" }
      ]
    });
    expect(r.success).toBe(false);
  });
});

describe("publishCardInput — география по типу", () => {
  const baseService = {
    type: "service" as const,
    categoryId: UUID,
    title: "Перевозка зерна",
    description: "Перевозка по регионам Казахстана",
    priceType: "on_request" as const,
    priceAmount: null,
    priceUnit: "за рейс",
    priceReason: "Зависит от маршрута",
    availability: "По согласованию",
    images: oneImage,
  };

  test("услуга принимает весь Казахстан или непустой список регионов", () => {
    expect(publishCardInput.safeParse({
      ...baseService,
      serviceAllKazakhstan: true,
      serviceTerritoryCodes: [],
    }).success).toBe(true);
    expect(publishCardInput.safeParse({
      ...baseService,
      serviceAllKazakhstan: false,
      serviceTerritoryCodes: ["akmola_region"],
    }).success).toBe(true);
    expect(publishCardInput.safeParse({
      ...baseService,
      serviceAllKazakhstan: false,
      serviceTerritoryCodes: [],
    }).success).toBe(false);
  });

  test("товар не принимает географию услуги", () => {
    expect(publishCardInput.safeParse({
      ...baseCard,
      priceType: "fixed",
      priceAmount: 120000,
      serviceTerritoryCodes: ["akmola_region"],
    }).success).toBe(false);
  });

  test("товар принимает только область, но не город республиканского значения", () => {
    expect(createCardInput.safeParse({
      ...baseCard,
      territoryCode: "kostanay_region",
      priceType: "fixed",
      priceAmount: 120000,
    }).success).toBe(true);
    expect(createCardInput.safeParse({
      ...baseCard,
      territoryCode: "almaty_city",
      priceType: "fixed",
      priceAmount: 120000,
    }).success).toBe(false);
  });
});

describe("volumeTonnesSchema", () => {
  test("принимает допустимые значения с точностью до трёх знаков", () => {
    for (const value of [VOLUME_MIN, 1.001, 1.003, 12.375, VOLUME_MAX]) {
      expect(volumeTonnesSchema.safeParse(value).success).toBe(true);
    }
  });

  test("отклоняет значения вне диапазона и с четвёртым знаком", () => {
    for (const value of [0, 0.0009, 1.0001, VOLUME_MAX + VOLUME_MIN]) {
      expect(volumeTonnesSchema.safeParse(value).success).toBe(false);
    }
  });
});

describe("createRequestInput — источник", () => {
  const contacts = {
    clientRequestId: UUID,
    contactName: "Айбек",
    contactPhone: "87011234567",
  };

  test("card требует cardId и нормализует телефон", () => {
    const r = createRequestInput.safeParse({ source: "card", cardId: UUID, ...contacts });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.contactPhone).toBe("+77011234567");
  });

  test("card без cardId — ошибка", () => {
    const r = createRequestInput.safeParse({ source: "card", ...contacts });
    expect(r.success).toBe(false);
  });

  test("tab требует tabType", () => {
    expect(createRequestInput.safeParse({ source: "tab", tabType: "service", ...contacts }).success).toBe(true);
    expect(createRequestInput.safeParse({ source: "tab", ...contacts }).success).toBe(false);
  });

  test("пробельное уточнение места товара нормализуется в отсутствие значения", () => {
    const parsed = createRequestInput.parse({
      source: "tab",
      tabType: "product",
      listingSubmission: {
        type: "product",
        categoryId: UUID,
        territoryCode: "kostanay_region",
        ownershipForm: "peasant_farm",
        productLocation: "elevator",
        productLocationDetail: "   ",
      },
      ...contacts,
    });
    expect(parsed.source === "tab" && parsed.listingSubmission?.type === "product").toBe(true);
    if (parsed.source === "tab" && parsed.listingSubmission?.type === "product") {
      expect(parsed.listingSubmission.productLocationDetail).toBeUndefined();
    }
  });

  test("profile — только контакты", () => {
    expect(createRequestInput.safeParse({ source: "profile", ...contacts }).success).toBe(true);
  });
});

describe("contactNameSchema", () => {
  test("слишком длинное имя — ошибка", () => {
    expect(contactNameSchema.safeParse("a".repeat(101)).success).toBe(false);
  });

  test("пустое имя — ошибка", () => {
    expect(contactNameSchema.safeParse("   ").success).toBe(false);
  });
});

describe("createUploadUrlInput", () => {
  test("допустимый contentType валиден", () => {
    expect(createUploadUrlInput.safeParse({ contentType: "image/webp" }).success).toBe(true);
  });

  test("недопустимый contentType — ошибка", () => {
    expect(createUploadUrlInput.safeParse({ contentType: "image/gif" }).success).toBe(false);
  });
});

describe("adminCardListQuery", () => {
  test("по умолчанию archived = all, пустая строка поиска игнорируется", () => {
    const r = adminCardListQuery.safeParse({ search: "" });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.archived).toBe("all");
      expect(r.data.search).toBeUndefined();
    }
  });

  test("archived принимает только all/active/archived", () => {
    expect(adminCardListQuery.safeParse({ archived: "hidden" }).success).toBe(false);
  });
});

describe("adminPlatformSettingsSchema", () => {
  test("adminChatId может быть null", () => {
    const r = adminPlatformSettingsSchema.safeParse({
      contactPhone: null,
      whatsappPhone: null,
      telegramContact: null,
      email: null,
      adminChatId: null
    });
    expect(r.success).toBe(true);
  });
});

describe("categoryListQuery", () => {
  test("пустые категории включаются только по явному флагу", () => {
    expect(categoryListQuery.parse({ type: "product" }).includeEmpty).toBe(false);
    expect(categoryListQuery.parse({ type: "product", includeEmpty: "true" }).includeEmpty).toBe(true);
    expect(categoryListQuery.parse({ type: "product", includeEmpty: "false" }).includeEmpty).toBe(false);
  });
});

describe("cardListQuery — фильтры товаров", () => {
  test("разбирает сортировку, области, группы и формы собственности", () => {
    const parsed = cardListQuery.parse({
      type: "product",
      sort: "volume_asc",
      region: "kostanay_region",
      commodityGroups: "cereals,pulses",
      ownershipForms: "peasant_farm,llp_trader",
      productLocation: "elevator",
    });
    expect(parsed.sort).toBe("volume_asc");
    expect(parsed.commodityGroups).toEqual(["cereals", "pulses"]);
    expect(parsed.ownershipForms).toEqual(["peasant_farm", "llp_trader"]);
  });

  test("не принимает города республиканского значения как область товара", () => {
    expect(cardListQuery.safeParse({ type: "product", region: "almaty_city" }).success).toBe(false);
    expect(cardListQuery.safeParse({ type: "product", region: "republican_cities" }).success).toBe(false);
    expect(cardListQuery.safeParse({ type: "service", region: "republican_cities" }).success).toBe(true);
  });

  test("не принимает повторяющиеся значения фильтра", () => {
    expect(cardListQuery.safeParse({ type: "product", commodityGroups: "cereals,cereals" }).success).toBe(false);
    expect(cardListQuery.safeParse({ type: "product", ownershipForms: "peasant_farm,peasant_farm" }).success).toBe(false);
  });
});

describe("favoritesPageQuery", () => {
  test("использует bounded default и принимает opaque cursor", () => {
    expect(favoritesPageQuery.parse({ pagination: "cursor" }).limit).toBe(20);
    expect(favoritesPageQuery.parse({ pagination: "cursor", cursor: "eyJjcmVhdGVkQXQiOiJ0In0" }).cursor).toBe("eyJjcmVhdGVkQXQiOiJ0In0");
  });

  test("отклоняет пустой cursor и limit за безопасной границей", () => {
    expect(favoritesPageQuery.safeParse({ pagination: "cursor", cursor: "" }).success).toBe(false);
    expect(favoritesPageQuery.safeParse({ pagination: "cursor", limit: 51 }).success).toBe(false);
  });
});

describe("favoriteMembershipQuery", () => {
  test("принимает bounded batch уникальных UUID", () => {
    expect(favoriteMembershipQuery.parse({ cardIds: `${UUID},22222222-2222-4222-8222-222222222222` }).cardIds).toHaveLength(2);
  });

  test("отклоняет duplicate и некорректный UUID", () => {
    expect(favoriteMembershipQuery.safeParse({ cardIds: `${UUID},${UUID}` }).success).toBe(false);
    expect(favoriteMembershipQuery.safeParse({ cardIds: "not-a-uuid" }).success).toBe(false);
  });
});
