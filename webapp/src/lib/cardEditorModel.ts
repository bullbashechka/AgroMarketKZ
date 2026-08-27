import type {
  AdminCardDetail,
  CardDetail,
  CatalogType,
  CommodityGroup,
  PriceType,
  ProductLocation,
  ProductOwnershipForm,
  Territory,
  TerritoryCode,
} from "@agromarket/contracts";
import type { CardDraft } from "./cardDraft";

export interface EditorSpec {
  localId: string;
  key: string;
  value: string;
}

export interface EditorState {
  type: CatalogType;
  categoryId: string;
  title: string;
  description: string;
  priceType: PriceType;
  priceAmount: string;
  priceUnit: string;
  priceReason: string;
  territoryCode: TerritoryCode | "";
  ownershipForm: ProductOwnershipForm | "";
  productLocation: ProductLocation | "";
  productLocationDetail: string;
  commodityGroup: CommodityGroup | "";
  volumeTonnes: string;
  serviceAllKazakhstan: boolean;
  serviceTerritoryCodes: TerritoryCode[];
  availability: string;
  specs: EditorSpec[];
}

type EditorSource = {
  initial?: AdminCardDetail;
  draft?: CardDraft;
  initialType?: CatalogType;
};

export type CompletedEditorImage = {
  storagePath: string;
  publicUrl: string;
};

export function createEditorState(
  { initial, draft, initialType }: EditorSource,
  createId: () => string = crypto.randomUUID,
): EditorState {
  const type = initial?.type ?? draft?.type ?? initialType ?? "service";
  const priceType = initial?.priceType ?? draft?.priceType ?? "fixed";
  return {
    type,
    categoryId: initial?.categoryId ?? draft?.categoryId ?? "",
    title: initial?.title ?? draft?.title ?? "",
    description: initial?.description ?? draft?.description ?? "",
    priceType: type === "product" && priceType === "on_request" ? "fixed" : priceType,
    priceAmount: initial?.priceAmount != null ? String(initial.priceAmount) : draft?.priceAmount ?? "",
    priceUnit: initial?.priceUnit ?? draft?.priceUnit ?? "",
    priceReason: initial?.priceReason ?? draft?.priceReason ?? "",
    territoryCode: initial?.territory?.code ?? draft?.territoryCode ?? "",
    ownershipForm: initial?.ownershipForm ?? draft?.ownershipForm ?? "",
    productLocation: initial?.productLocation ?? draft?.productLocation ?? "",
    productLocationDetail: initial?.productLocationDetail ?? draft?.productLocationDetail ?? "",
    commodityGroup: initial?.commodityGroup ?? draft?.commodityGroup ?? "",
    volumeTonnes: initial?.volumeTonnes != null ? String(initial.volumeTonnes) : draft?.volumeTonnes ?? "",
    serviceAllKazakhstan: initial?.serviceAllKazakhstan ?? draft?.serviceAllKazakhstan ?? false,
    serviceTerritoryCodes: initial?.serviceTerritories.map((territory) => territory.code) ?? draft?.serviceTerritoryCodes ?? [],
    availability: initial?.availability ?? draft?.availability ?? "",
    specs: (initial?.specs ?? draft?.specs ?? []).map((spec) => ({ localId: createId(), key: spec.key, value: spec.value })),
  };
}

/** A type switch retains common data and clears only fields that belong to the other listing kind. */
export function changeEditorType(state: EditorState, type: CatalogType): EditorState {
  if (type === state.type) return state;
  return {
    ...state,
    type,
    priceType: type === "product" && state.priceType === "on_request" ? "fixed" : state.priceType,
    priceReason: type === "product" && state.priceType === "on_request" ? "" : state.priceReason,
    categoryId: "",
    territoryCode: "",
    ownershipForm: "",
    productLocation: "",
    productLocationDetail: "",
    commodityGroup: "",
    volumeTonnes: "",
    serviceAllKazakhstan: false,
    serviceTerritoryCodes: [],
  };
}

export function changeEditorCategory(state: EditorState, categoryId: string, isCommodity: boolean): EditorState {
  return isCommodity
    ? { ...state, categoryId }
    : { ...state, categoryId, commodityGroup: "", volumeTonnes: "" };
}

export function syncRequiredSpecs(
  state: EditorState,
  requiredSpecs: string[],
  createId: () => string = crypto.randomUUID,
): EditorState {
  const existing = new Set(state.specs.map((spec) => spec.key.trim().toLocaleLowerCase("ru")));
  const missing = requiredSpecs.filter((key) => !existing.has(key.trim().toLocaleLowerCase("ru")));
  return missing.length === 0
    ? state
    : { ...state, specs: [...state.specs, ...missing.map((key) => ({ localId: createId(), key, value: "" }))] };
}

export function toggleEditorServiceTerritory(state: EditorState, territoryCode: TerritoryCode): EditorState {
  return {
    ...state,
    serviceTerritoryCodes: state.serviceTerritoryCodes.includes(territoryCode)
      ? state.serviceTerritoryCodes.filter((code) => code !== territoryCode)
      : [...state.serviceTerritoryCodes, territoryCode],
  };
}

export function toDraft(
  state: EditorState,
  clientRequestId: string | undefined,
  images: CompletedEditorImage[],
): CardDraft {
  return {
    clientRequestId,
    type: state.type,
    categoryId: state.categoryId,
    title: state.title,
    description: state.description,
    priceType: state.priceType,
    priceAmount: state.priceAmount,
    priceUnit: state.priceUnit,
    priceReason: state.priceReason,
    territoryCode: state.territoryCode || undefined,
    ownershipForm: state.ownershipForm || undefined,
    productLocation: state.productLocation || undefined,
    productLocationDetail: state.productLocationDetail,
    commodityGroup: state.commodityGroup || undefined,
    volumeTonnes: state.volumeTonnes || undefined,
    serviceAllKazakhstan: state.serviceAllKazakhstan,
    serviceTerritoryCodes: state.serviceTerritoryCodes,
    availability: state.availability,
    specs: state.specs.map(({ key, value }) => ({ key, value })),
    images,
  };
}

export function toMutationInput(
  state: EditorState,
  options: {
    clientRequestId?: string;
    sortOrder: number;
    categoryIsCommodity: boolean;
    images: CompletedEditorImage[];
    completeSpecsOnly?: boolean;
  },
) {
  const specs = options.completeSpecsOnly
    ? state.specs.filter((spec) => spec.key.trim() && spec.value.trim())
    : state.specs;
  return {
    clientRequestId: options.clientRequestId,
    type: state.type,
    categoryId: state.categoryId,
    title: state.title,
    description: state.description,
    sortOrder: options.sortOrder,
    priceType: state.priceType,
    priceAmount: state.priceType === "on_request" || !state.priceAmount ? null : Number(state.priceAmount),
    priceUnit: state.priceUnit,
    priceReason: state.priceType === "fixed" ? null : state.priceReason,
    location: null,
    territoryCode: state.type === "product" ? state.territoryCode || null : null,
    ownershipForm: state.type === "product" ? state.ownershipForm || null : null,
    productLocation: state.type === "product" ? state.productLocation || null : null,
    productLocationDetail: state.type === "product" ? state.productLocationDetail || null : null,
    commodityGroup: state.type === "product" && options.categoryIsCommodity ? state.commodityGroup || null : null,
    volumeTonnes: state.type === "product" && options.categoryIsCommodity && state.volumeTonnes
      ? Number(state.volumeTonnes.replace(",", "."))
      : null,
    serviceAllKazakhstan: state.type === "service" && state.serviceAllKazakhstan,
    serviceTerritoryCodes: state.type === "service" && !state.serviceAllKazakhstan ? state.serviceTerritoryCodes : [],
    availability: state.type === "service" ? state.availability : null,
    images: options.images.map((image, sortOrder) => ({ storagePath: image.storagePath, sortOrder })),
    specs: specs.map((spec, sortOrder) => ({ key: spec.key, value: spec.value, sortOrder })),
  };
}

export function toPreview(
  state: EditorState,
  options: {
    initial?: AdminCardDetail;
    categoryIsCommodity: boolean;
    territories: Territory[];
    images: CompletedEditorImage[];
  },
): CardDetail {
  const mutation = toMutationInput(state, {
    sortOrder: options.initial?.sortOrder ?? 0,
    categoryIsCommodity: options.categoryIsCommodity,
    images: options.images,
    completeSpecsOnly: true,
  });
  return {
    id: options.initial?.id ?? "00000000-0000-4000-8000-000000000001",
    type: mutation.type,
    categoryId: mutation.categoryId || "00000000-0000-4000-8000-000000000002",
    title: mutation.title || "Карточка без названия",
    description: mutation.description,
    priceType: mutation.priceType,
    priceAmount: mutation.priceAmount ?? null,
    priceUnit: mutation.priceUnit || null,
    priceReason: mutation.priceReason || null,
    commodityGroup: mutation.commodityGroup ?? null,
    volumeTonnes: mutation.volumeTonnes ?? null,
    location: null,
    territory: mutation.type === "product"
      ? options.territories.find((territory) => territory.code === mutation.territoryCode) ?? null
      : null,
    ownershipForm: mutation.ownershipForm ?? null,
    productLocation: mutation.productLocation ?? null,
    productLocationDetail: mutation.productLocationDetail ?? null,
    serviceAllKazakhstan: mutation.serviceAllKazakhstan,
    serviceTerritories: state.type === "service"
      ? options.territories.filter((territory) => state.serviceTerritoryCodes.includes(territory.code))
      : [],
    availability: mutation.availability ?? null,
    sortOrder: mutation.sortOrder,
    version: options.initial?.version ?? 1,
    publishedAt: options.initial?.publishedAt ?? null,
    archivedAt: options.initial?.archivedAt ?? null,
    createdAt: options.initial?.createdAt ?? new Date().toISOString(),
    updatedAt: options.initial?.updatedAt ?? new Date().toISOString(),
    images: options.images.map((image, index) => ({
      id: `00000000-0000-4000-8000-${String(index + 10).padStart(12, "0")}`,
      storagePath: image.storagePath,
      url: image.publicUrl,
      altText: null,
      sortOrder: index,
    })),
    specs: mutation.specs.map((spec, index) => ({
      id: `00000000-0000-4000-8000-${String(index + 100).padStart(12, "0")}`,
      ...spec,
    })),
  };
}
