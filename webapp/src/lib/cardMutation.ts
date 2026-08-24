import type { AdminCardDetail, CreateCardInput } from "@agromarket/contracts";

/** Сохраняет результат первого шага, если второй шаг publish завершился ошибкой. */
export class PublishAfterSaveError extends Error {
  constructor(
    public readonly saved: AdminCardDetail,
    public readonly publishError: unknown,
  ) {
    super("Публикация не завершилась после сохранения карточки");
    this.name = "PublishAfterSaveError";
  }
}

function normalizeText(value: string | null | undefined): string | null {
  if (value == null) return null;
  return value.trim().replace(/маслянич/giu, (match) => {
    if (match === match.toLocaleUpperCase("ru")) return "МАСЛИЧ";
    return match[0] === match[0]?.toLocaleUpperCase("ru") ? "Маслич" : "маслич";
  });
}

function sameStrings(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

/** Проверяет, что GET после неоднозначного PUT отражает именно отправленные данные. */
export function cardMatchesInput(
  card: AdminCardDetail,
  input: CreateCardInput,
  expectedVersion: number,
): boolean {
  if (card.version <= expectedVersion) return false;

  const expectedPriceAmount = input.priceType === "on_request" ? null : input.priceAmount ?? null;
  const expectedPriceReason = input.priceType === "fixed" ? null : input.priceReason ?? null;
  const expectedServiceTerritories = input.type === "service" && !input.serviceAllKazakhstan
    ? input.serviceTerritoryCodes
    : [];

  return card.type === input.type
    && card.categoryId === input.categoryId
    && normalizeText(card.title) === normalizeText(input.title)
    && normalizeText(card.description) === normalizeText(input.description)
    && card.priceType === input.priceType
    && card.priceAmount === expectedPriceAmount
    && normalizeText(card.priceUnit) === normalizeText(input.priceUnit)
    && normalizeText(card.priceReason) === normalizeText(expectedPriceReason)
    && normalizeText(card.availability) === normalizeText(
      input.type === "service" || card.availability !== null ? input.availability : null,
    )
    && card.sortOrder === input.sortOrder
    && (card.territory?.code ?? null) === (input.type === "product" ? input.territoryCode ?? null : null)
    && card.ownershipForm === (input.type === "product" ? input.ownershipForm ?? null : null)
    && card.productLocation === (input.type === "product" ? input.productLocation ?? null : null)
    && normalizeText(card.productLocationDetail) === normalizeText(
      input.type === "product" ? input.productLocationDetail : null,
    )
    && (card.commodityGroup ?? null) === (input.type === "product" ? input.commodityGroup ?? null : null)
    && (card.volumeTonnes ?? null) === (input.type === "product" && input.volumeTonnes != null ? input.volumeTonnes : null)
    && card.serviceAllKazakhstan === (input.type === "service" && input.serviceAllKazakhstan)
    && sameStrings(
      card.serviceTerritories.map((territory) => territory.code),
      expectedServiceTerritories,
    )
    && sameStrings(
      card.images.map((image) => `${image.storagePath}\u0000${image.altText ?? ""}\u0000${image.sortOrder}`),
      input.images.map((image) => `${image.storagePath}\u0000${image.altText ?? ""}\u0000${image.sortOrder}`),
    )
    && card.specs.length === input.specs.length
    && card.specs.every((spec, index) => {
      const expected = input.specs[index];
      return expected !== undefined
        && normalizeText(spec.key) === normalizeText(expected.key)
        && normalizeText(spec.value) === normalizeText(expected.value)
        && spec.sortOrder === expected.sortOrder;
    });
}
