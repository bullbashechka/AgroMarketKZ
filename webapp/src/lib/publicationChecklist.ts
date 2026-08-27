import {
  getPublicationPolicyIssues,
  type CatalogType,
  type PriceType,
  type ProductLocation,
  type ProductOwnershipForm,
  type TerritoryCode,
  type CommodityGroup,
} from "@agromarket/contracts";

export interface LivePublicationInput {
  title: string;
  categoryId: string;
  categoryState: "loading" | "error" | "ready";
  categoryFound: boolean;
  requiredSpecs: string[];
  type: CatalogType;
  description: string;
  priceType: PriceType;
  priceAmount: number | null;
  priceUnit: string | null;
  priceReason: string | null;
  territoryCode: TerritoryCode | null;
  ownershipForm: ProductOwnershipForm | null;
  productLocation: ProductLocation | null;
  categoryIsCommodity?: boolean;
  commodityGroup?: CommodityGroup | null;
  volumeTonnes?: number | null;
  serviceAllKazakhstan: boolean;
  serviceTerritoryCount: number;
  availability: string | null;
  imageCount: number;
  imagePending: boolean;
  imageError: boolean;
  specs: Array<{ key: string; value: string }>;
}

/** Live UI checklist; publication remains authoritative on the backend. */
export function getLivePublicationIssues(input: LivePublicationInput): string[] {
  const issues: string[] = [];
  if (!input.title.trim()) issues.push("Укажите название");
  if (!input.categoryId) issues.push("Выберите категорию");
  if (input.categoryState === "loading") {
    issues.push("Проверяем требования категории");
  } else if (input.categoryState === "error") {
    issues.push("Не удалось проверить требования категории");
  } else if (input.categoryId && !input.categoryFound) {
    issues.push("Выберите доступную категорию");
  }

  const contentIssues = getPublicationPolicyIssues({
    type: input.type,
    description: input.description,
    priceType: input.priceType,
    priceAmount: input.priceAmount,
    priceUnit: input.priceUnit,
    priceReason: input.priceReason,
    territoryCode: input.territoryCode,
    ownershipForm: input.ownershipForm,
    productLocation: input.productLocation,
    categoryIsCommodity: input.categoryIsCommodity,
    commodityGroup: input.commodityGroup,
    volumeTonnes: input.volumeTonnes,
    serviceAllKazakhstan: input.serviceAllKazakhstan,
    serviceTerritoryCount: input.serviceTerritoryCount,
    availability: input.availability,
    imageCount: input.imageCount,
    specs: input.specs,
    requiredSpecs: input.categoryState === "ready" && input.categoryFound ? input.requiredSpecs : [],
  });
  issues.push(...contentIssues.filter((issue) => issue.code !== "image_required").map((issue) => issue.message));

  if (input.imagePending) {
    issues.unshift("Дождитесь завершения загрузки фото");
  } else if (input.imageError) {
    issues.unshift("Исправьте ошибку загрузки фото");
  } else if (input.imageCount === 0) {
    issues.unshift("Добавьте хотя бы одно фото");
  }

  return [...new Set(issues)];
}
