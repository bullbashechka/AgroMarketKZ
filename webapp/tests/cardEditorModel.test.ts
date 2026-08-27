import { describe, expect, test } from "bun:test";
import type { AdminCardDetail, Territory } from "@agromarket/contracts";
import {
  changeEditorCategory,
  changeEditorType,
  createEditorState,
  syncRequiredSpecs,
  toDraft,
  toMutationInput,
  toPreview,
  toggleEditorServiceTerritory,
} from "../src/lib/cardEditorModel";

const territory: Territory = {
  code: "abay_region",
  name: "Абайская область",
  kind: "region",
  sortOrder: 1,
};

const draft = {
  clientRequestId: "11111111-1111-4111-8111-111111111111",
  type: "product" as const,
  categoryId: "22222222-2222-4222-8222-222222222222",
  title: "Пшеница",
  description: "Пшеница третьего класса",
  priceType: "on_request" as const,
  priceAmount: "120000",
  priceUnit: "за тонну",
  priceReason: "По договорённости",
  territoryCode: "abay_region" as const,
  ownershipForm: "peasant_farm" as const,
  productLocation: "elevator" as const,
  productLocationDetail: "Элеватор № 1",
  commodityGroup: "cereals" as const,
  volumeTonnes: "12,375",
  serviceAllKazakhstan: false,
  serviceTerritoryCodes: [],
  availability: "",
  specs: [{ key: "Год выпуска", value: "2026" }],
  images: [{ storagePath: "cards/11111111-1111-4111-8111-111111111111.jpg", publicUrl: "https://example.test/card.jpg" }],
};

const initial = {
  ...draft,
  id: "33333333-3333-4333-8333-333333333333",
  type: "service",
  categoryId: "44444444-4444-4444-8444-444444444444",
  priceType: "on_request",
  priceAmount: null,
  priceReason: "Зависит от маршрута",
  territory: null,
  ownershipForm: null,
  productLocation: null,
  productLocationDetail: null,
  commodityGroup: null,
  volumeTonnes: null,
  serviceAllKazakhstan: true,
  serviceTerritories: [],
  availability: "По согласованию",
  sortOrder: 3,
  version: 2,
  publishedAt: null,
  archivedAt: null,
  createdAt: "2026-08-27T00:00:00.000Z",
  updatedAt: "2026-08-27T00:00:00.000Z",
  images: [{
    id: "55555555-5555-4555-8555-555555555555",
    storagePath: draft.images[0]!.storagePath,
    url: draft.images[0]!.publicUrl,
    altText: null,
    sortOrder: 0,
  }],
  specs: [{ id: "66666666-6666-4666-8666-666666666666", key: "Срок", value: "3 дня", sortOrder: 0 }],
  publicationStatus: "draft",
  needsReview: false,
  reviewIssues: [],
} as AdminCardDetail;

describe("cardEditorModel", () => {
  test("нормализует входящие draft и DTO один раз", () => {
    const fromDraft = createEditorState({ draft }, () => "draft-spec");
    expect(fromDraft.priceType).toBe("fixed");
    expect(fromDraft.priceReason).toBe(draft.priceReason);
    expect(fromDraft.specs).toEqual([{ localId: "draft-spec", key: "Год выпуска", value: "2026" }]);

    const fromDto = createEditorState({ initial }, () => "dto-spec");
    expect(fromDto).toMatchObject({ type: "service", categoryId: initial.categoryId, priceType: "on_request" });
    expect(fromDto.specs).toEqual([{ localId: "dto-spec", key: "Срок", value: "3 дня" }]);
  });

  test("переходы product/service/category очищают только несовместимые поля", () => {
    const product = createEditorState({ draft }, () => "spec");
    const service = changeEditorType(product, "service");
    expect(service).toMatchObject({
      type: "service",
      categoryId: "",
      territoryCode: "",
      ownershipForm: "",
      productLocation: "",
      commodityGroup: "",
      volumeTonnes: "",
      serviceTerritoryCodes: [],
    });
    expect(service.title).toBe(draft.title);

    const nonCommodity = changeEditorCategory(product, "new-category", false);
    expect(nonCommodity).toMatchObject({ categoryId: "new-category", commodityGroup: "", volumeTonnes: "" });
    expect(toggleEditorServiceTerritory(service, territory.code).serviceTerritoryCodes).toEqual([territory.code]);

    const serviceOnRequest = {
      ...service,
      priceType: "on_request" as const,
      priceReason: "Зависит от маршрута",
      serviceAllKazakhstan: true,
      serviceTerritoryCodes: [territory.code],
    };
    expect(changeEditorType(serviceOnRequest, "product")).toMatchObject({
      type: "product",
      priceType: "fixed",
      priceReason: "",
      serviceAllKazakhstan: false,
      serviceTerritoryCodes: [],
    });
  });

  test("draft, mutation и preview получают один нормализованный путь", () => {
    const state = syncRequiredSpecs(createEditorState({ draft }, () => "existing"), ["Год выпуска", "Состояние"], () => "missing");
    const images = draft.images;
    const savedDraft = toDraft(state, draft.clientRequestId, images);
    const mutation = toMutationInput(state, {
      clientRequestId: draft.clientRequestId,
      sortOrder: 0,
      categoryIsCommodity: true,
      images,
    });
    const preview = toPreview(state, {
      categoryIsCommodity: true,
      territories: [territory],
      images,
    });

    expect(savedDraft.specs.map((spec) => spec.key)).toEqual(["Год выпуска", "Состояние"]);
    expect(mutation).toMatchObject({
      type: "product",
      priceAmount: 120000,
      commodityGroup: "cereals",
      volumeTonnes: 12.375,
      images: [{ storagePath: images[0]!.storagePath, sortOrder: 0 }],
    });
    expect(preview).toMatchObject({ title: draft.title, territory, images: [{ url: images[0]!.publicUrl }] });

    const serviceState = {
      ...state,
      type: "service" as const,
      priceType: "on_request" as const,
      serviceAllKazakhstan: true,
      serviceTerritoryCodes: [territory.code],
      availability: "По согласованию",
    };
    const serviceMutation = toMutationInput(serviceState, {
      sortOrder: 0,
      categoryIsCommodity: false,
      images,
    });
    const servicePreview = toPreview(serviceState, {
      categoryIsCommodity: false,
      territories: [territory],
      images,
    });
    expect(serviceMutation.serviceTerritoryCodes).toEqual([]);
    expect(servicePreview).toMatchObject({ serviceAllKazakhstan: true, serviceTerritories: [territory] });
  });
});
