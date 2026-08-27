import type { CatalogType, PriceType, PublicationStatus } from "./enums";
import { productTerritoryCodes } from "./territory";
import type { CommodityGroup, VolumeTonnes } from "./commodity";
import type { ProductLocation, ProductOwnershipForm } from "./territory";

export interface PublicationCandidate {
  type?: CatalogType;
  description: string;
  priceType: PriceType;
  priceAmount: number | null;
  priceUnit: string | null;
  priceReason: string | null;
  territoryCode: string | null;
  ownershipForm: ProductOwnershipForm | null;
  productLocation: ProductLocation | null;
  categoryIsCommodity?: boolean;
  commodityGroup?: CommodityGroup | null;
  volumeTonnes?: VolumeTonnes | null;
  serviceAllKazakhstan: boolean;
  serviceTerritoryCount: number;
  /** Совместимость с проверками и устаревшими карточками до структурированных территорий. */
  location?: string | null;
  availability: string | null;
  imageCount: number;
  specs: Array<{ key: string; value: string }>;
  requiredSpecs: string[];
}

export type PublicationIssueCode =
  | "description_required"
  | "image_required"
  | "product_territory_required"
  | "product_territory_invalid"
  | "ownership_form_required"
  | "product_location_required"
  | "commodity_group_required"
  | "volume_required"
  | "product_price_required"
  | "service_territory_required"
  | "legacy_location_required"
  | "availability_required"
  | "price_unit_required"
  | "price_amount_required"
  | "price_reason_required"
  | "required_spec_missing";

export interface PublicationIssue {
  code: PublicationIssueCode;
  path: string;
  message: string;
}

const normalizedKey = (value: string) => value.trim().toLocaleLowerCase("ru");

/** Canonical pure publication policy for schema, backend and live UI adapters. */
export function getPublicationPolicyIssues(candidate: PublicationCandidate): PublicationIssue[] {
  const issues: PublicationIssue[] = [];
  const add = (code: PublicationIssueCode, path: string, message: string) => issues.push({ code, path, message });
  if (!candidate.description.trim()) add("description_required", "description", "Добавьте описание");
  if (candidate.imageCount < 1) add("image_required", "images", "Добавьте хотя бы одно фото");
  if (candidate.type === "product") {
    const isLegacyProduct = candidate.categoryIsCommodity === undefined;
    if (!candidate.territoryCode) add("product_territory_required", "territoryCode", isLegacyProduct ? "Выберите регион" : "Выберите область");
    else if (!productTerritoryCodes.includes(candidate.territoryCode as typeof productTerritoryCodes[number])) add("product_territory_invalid", "territoryCode", "Выберите область");
    if (!candidate.ownershipForm) add("ownership_form_required", "ownershipForm", "Выберите форму собственности");
    if (!candidate.productLocation) add("product_location_required", "productLocation", "Выберите местонахождение");
    // Старые callers без categoryIsCommodity используют legacy-правила. Backend
    // передаёт флаг категории явно, поэтому новые карточки проверяются строго.
    const isCommodity = candidate.categoryIsCommodity === true;
    if (isCommodity) {
      if (!candidate.commodityGroup) add("commodity_group_required", "commodityGroup", "Выберите группу продукции");
      if (candidate.volumeTonnes == null) add("volume_required", "volumeTonnes", "Укажите объём в тоннах");
    }
    if (candidate.priceType === "on_request" && !isLegacyProduct) add("product_price_required", "priceType", "У товара всегда должна быть цена");
  } else if (!candidate.serviceAllKazakhstan && candidate.serviceTerritoryCount === 0) {
    add("service_territory_required", "serviceTerritoryCodes", "Выберите хотя бы один регион или весь Казахстан");
  } else if (!candidate.type && !candidate.location?.trim()) {
    add("legacy_location_required", "location", "Укажите регион или территорию");
  }
  if (candidate.type === "service" || !candidate.type) {
    if (!candidate.availability?.trim()) add("availability_required", "availability", "Укажите наличие или срок исполнения");
  }
  if (!candidate.priceUnit?.trim()) add("price_unit_required", "priceUnit", "Укажите единицу цены");
  if (candidate.priceType !== "on_request" && candidate.priceAmount == null) {
    add("price_amount_required", "priceAmount", "Укажите цену");
  }
  if (candidate.type !== "product" && candidate.priceType === "on_request" && !candidate.priceReason?.trim()) {
    add("price_reason_required", "priceReason", "Объясните, от чего зависит цена");
  }

  const filled = new Set(
    candidate.specs
      .filter((spec) => spec.value.trim().length > 0)
      .map((spec) => normalizedKey(spec.key)),
  );
  for (const key of candidate.requiredSpecs) {
    if (!filled.has(normalizedKey(key))) {
      add("required_spec_missing", "specs", `Заполните характеристику «${key.trim()}»`);
    }
  }
  return issues;
}

/** Compatibility projection for existing presentation DTOs. Do not use for decisions. */
export function getPublicationIssues(candidate: PublicationCandidate): string[] {
  return getPublicationPolicyIssues(candidate).map((issue) => issue.message);
}

export function getPublicationStatus(
  publishedAt: Date | null,
  archivedAt: Date | null,
): PublicationStatus {
  if (publishedAt === null) return "draft";
  return archivedAt === null ? "published" : "archived";
}
