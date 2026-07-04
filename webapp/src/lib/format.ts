import type { CatalogType, PriceType } from "@agromarket/contracts";

const priceFormatter = new Intl.NumberFormat("ru-RU");

/** Путь к экрану карточки: `/services/{categoryId}/{cardId}` или `/products/...`. */
export function cardHref(card: { type: CatalogType; categoryId: string; id: string }): string {
  const section = card.type === "service" ? "services" : "products";
  return `/${section}/${card.categoryId}/${card.id}`;
}

/** Цена для отображения: «1 500 000 ₸» либо «Цена по запросу». */
export function formatPrice(priceType: PriceType, priceAmount: number | null): string {
  if (priceType === "on_request" || priceAmount === null) return "Цена по запросу";
  return `${priceFormatter.format(priceAmount)} ₸`;
}

/** Только цифры телефона (с кодом страны, без «+») — для wa.me/tel-ссылок. */
export function phoneDigits(phone: string): string {
  return phone.replace(/\D/g, "");
}

/** wa.me-ссылка из телефона в любом формате. */
export function whatsappLink(phone: string): string {
  return `https://wa.me/${phoneDigits(phone)}`;
}

/**
 * t.me-ссылка из контакта площадки, который админ мог ввести как `@username`,
 * `username` или уже готовую ссылку `https://t.me/username` / `t.me/username`.
 */
export function telegramLink(contact: string): string {
  const trimmed = contact.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  const handle = trimmed.replace(/^@/, "").replace(/^t\.me\//i, "");
  return `https://t.me/${handle}`;
}
