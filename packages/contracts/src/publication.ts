import type { CatalogType, PriceType, PublicationStatus } from "./enums";
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
  serviceAllKazakhstan: boolean;
  serviceTerritoryCount: number;
  /** Совместимость с проверками и устаревшими карточками до структурированных территорий. */
  location?: string | null;
  availability: string | null;
  imageCount: number;
  specs: Array<{ key: string; value: string }>;
  requiredSpecs: string[];
}

const normalizedKey = (value: string) => value.trim().toLocaleLowerCase("ru");

/** Единая проверка качества для публикации, повторного открытия и live-чек-листа. */
export function getPublicationIssues(candidate: PublicationCandidate): string[] {
  const issues: string[] = [];
  if (!candidate.description.trim()) issues.push("Добавьте описание");
  if (candidate.imageCount < 1) issues.push("Добавьте хотя бы одно фото");
  if (candidate.type === "product") {
    if (!candidate.territoryCode) issues.push("Выберите регион");
    if (!candidate.ownershipForm) issues.push("Выберите форму собственности");
    if (!candidate.productLocation) issues.push("Выберите местонахождение");
  } else if (!candidate.serviceAllKazakhstan && candidate.serviceTerritoryCount === 0) {
    issues.push("Выберите хотя бы один регион или весь Казахстан");
  } else if (!candidate.type && !candidate.location?.trim()) {
    issues.push("Укажите регион или территорию");
  }
  if (!candidate.availability?.trim()) issues.push("Укажите наличие или срок исполнения");
  if (!candidate.priceUnit?.trim()) issues.push("Укажите единицу цены");
  if (candidate.priceType !== "on_request" && candidate.priceAmount == null) {
    issues.push("Укажите цену");
  }
  if (candidate.priceType === "on_request" && !candidate.priceReason?.trim()) {
    issues.push("Объясните, от чего зависит цена");
  }

  const filled = new Set(
    candidate.specs
      .filter((spec) => spec.value.trim().length > 0)
      .map((spec) => normalizedKey(spec.key)),
  );
  for (const key of candidate.requiredSpecs) {
    if (!filled.has(normalizedKey(key))) {
      issues.push(`Заполните характеристику «${key.trim()}»`);
    }
  }
  return issues;
}

export function getPublicationStatus(
  publishedAt: Date | null,
  archivedAt: Date | null,
): PublicationStatus {
  if (publishedAt === null) return "draft";
  return archivedAt === null ? "published" : "archived";
}
