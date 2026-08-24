import { describe, expect, test } from "bun:test";
import { createCardInput, type AdminCardDetail } from "@agromarket/contracts";
import { cardMatchesInput, PublishAfterSaveError } from "../src/lib/cardMutation";

const input = createCardInput.parse({
  type: "product",
  categoryId: "00000000-0000-4000-8000-000000000001",
  title: "Карточка",
  description: "Описание",
  priceType: "fixed",
  priceAmount: 1000,
  priceUnit: "за тонну",
  territoryCode: "abay_region",
  ownershipForm: "peasant_farm",
  productLocation: "elevator",
  productLocationDetail: null,
  availability: "В наличии",
  images: [{ storagePath: "cards/image.jpg", sortOrder: 0 }],
  specs: [{ key: "Год выпуска", value: "2026", sortOrder: 0 }],
});

function card(overrides: Partial<AdminCardDetail> = {}): AdminCardDetail {
  return {
    id: "00000000-0000-4000-8000-000000000002",
    type: "product",
    categoryId: input.categoryId,
    title: input.title,
    description: input.description,
    priceType: "fixed",
    priceAmount: 1000,
    priceUnit: input.priceUnit ?? null,
    priceReason: null,
    location: "Абайская область",
    territory: { code: "abay_region", name: "Абайская область", kind: "region", sortOrder: 10 },
    ownershipForm: "peasant_farm",
    productLocation: "elevator",
    productLocationDetail: null,
    serviceAllKazakhstan: false,
    serviceTerritories: [],
    availability: "В наличии",
    sortOrder: 0,
    version: 2,
    publishedAt: null,
    archivedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    images: [{
      id: "00000000-0000-4000-8000-000000000003",
      storagePath: "cards/image.jpg",
      url: "https://example.test/image.jpg",
      altText: null,
      sortOrder: 0,
    }],
    specs: [{
      id: "00000000-0000-4000-8000-000000000004",
      key: "Год выпуска",
      value: "2026",
      sortOrder: 0,
    }],
    publicationStatus: "draft",
    needsReview: false,
    reviewIssues: [],
    ...overrides,
  };
}

describe("cardMatchesInput", () => {
  test("recognizes the committed update by version and persisted fields", () => {
    expect(cardMatchesInput(card(), input, 1)).toBe(true);
  });

  test("rejects an unchanged version or a different persisted field", () => {
    expect(cardMatchesInput(card({ version: 1 }), input, 1)).toBe(false);
    expect(cardMatchesInput(card({ title: "Другая карточка" }), input, 1)).toBe(false);
  });
});

test("PublishAfterSaveError keeps the committed card for save → publish recovery", () => {
  const saved = card();
  const publishError = new Error("publish rejected");
  const error = new PublishAfterSaveError(saved, publishError);

  expect(error.saved).toBe(saved);
  expect(error.publishError).toBe(publishError);
});
