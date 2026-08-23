import { describe, expect, test } from "bun:test";
import { createCardInput, publishCardInput } from "../src/card";
import { createRequestInput } from "../src/request";
import { contactNameSchema } from "../src/primitives";
import { createUploadUrlInput } from "../src/upload";
import { adminCardListQuery } from "../src/admin";
import { adminPlatformSettingsSchema } from "../src/settings";
import { categoryListQuery } from "../src/catalog";

const UUID = "11111111-1111-4111-8111-111111111111";
const oneImage = [{ storagePath: "cards/a.jpg" }];

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

  test("on_request требует причину и не принимает сумму", () => {
    expect(
      publishCardInput.safeParse({
        ...baseCard,
        priceType: "on_request",
        priceAmount: null,
        priceReason: "Зависит от региона и объёма",
      }).success,
    ).toBe(true);
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
