import type { CatalogType, PriceType, ProductLocation, ProductOwnershipForm, TerritoryCode } from "@agromarket/contracts";
import type { DraftImage } from "./useImageUploads";

const DRAFT_KEY = "agromarket.cardDraft";

export interface CardDraftSpec {
  key: string;
  value: string;
}

/** Черновик формы создания карточки — только для create (в edit не читается и не пишется). */
export interface CardDraft {
  type: CatalogType;
  categoryId: string;
  title: string;
  description: string;
  priceType: PriceType;
  priceAmount: string;
  priceUnit: string;
  priceReason: string;
  territoryCode?: TerritoryCode;
  ownershipForm?: ProductOwnershipForm;
  productLocation?: ProductLocation;
  productLocationDetail?: string;
  serviceAllKazakhstan?: boolean;
  serviceTerritoryCodes?: TerritoryCode[];
  availability: string;
  specs: CardDraftSpec[];
  images: DraftImage[];
}

function isNonEmptyDraft(draft: CardDraft): boolean {
  return (
    draft.title.trim().length > 0 ||
    draft.description.trim().length > 0 ||
    draft.specs.length > 0 ||
    draft.images.length > 0
  );
}

/** Черновик, если он есть и не пустой (пустая форма не считается черновиком). */
export function loadCardDraft(): CardDraft | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const draft = JSON.parse(raw) as CardDraft;
    return isNonEmptyDraft(draft) ? draft : null;
  } catch {
    return null;
  }
}

export function saveCardDraft(draft: CardDraft): void {
  try {
    if (!isNonEmptyDraft(draft)) {
      localStorage.removeItem(DRAFT_KEY);
      return;
    }
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch {
    // localStorage недоступен (приватный режим/квота) — черновик не критичен, тихо игнорируем.
  }
}

export function clearCardDraft(): void {
  try {
    localStorage.removeItem(DRAFT_KEY);
  } catch {
    // см. выше
  }
}
