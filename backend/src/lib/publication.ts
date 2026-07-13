import type { PriceType, PublicationStatus } from "@agromarket/contracts";

export interface PublicationCandidate {
  description: string;
  priceType: PriceType;
  priceAmount: number | null;
  priceUnit: string | null;
  priceReason: string | null;
  location: string | null;
  availability: string | null;
  imageCount: number;
  specs: Array<{ key: string; value: string }>;
  requiredSpecs: string[];
}

const normalizedKey = (value: string) => value.trim().toLocaleLowerCase("ru");

/** Единая серверная проверка качества для публикации, повторного открытия и needsReview. */
export function getPublicationIssues(candidate: PublicationCandidate): string[] {
  const issues: string[] = [];
  if (!candidate.description.trim()) issues.push("Добавьте описание");
  if (candidate.imageCount < 1) issues.push("Добавьте хотя бы одно фото");
  if (!candidate.location?.trim()) issues.push("Укажите регион или территорию");
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
