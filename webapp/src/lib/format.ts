import type { CatalogType, PriceType } from "@agromarket/contracts";

const priceFormatter = new Intl.NumberFormat("ru-RU");
const dateTimeFormatter = new Intl.DateTimeFormat("ru-RU", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit"
});

/** Дата и время в формате «04.07.2026, 14:02» (для заявок и списка пользователей). */
export function formatDateTime(iso: string): string {
  return dateTimeFormatter.format(new Date(iso));
}

/** Путь к экрану карточки: `/services/{categoryId}/{cardId}` или `/products/...`. */
export function cardHref(card: { type: CatalogType; categoryId: string; id: string }): string {
  const section = card.type === "service" ? "services" : "products";
  return `/${section}/${card.categoryId}/${card.id}`;
}

/** Цена для отображения вместе с единицей. */
export function formatPrice(priceType: PriceType, priceAmount: number | null, priceUnit: string | null = null): string {
  if (priceType === "on_request" || priceAmount === null) return "Цена по запросу";
  const prefix = priceType === "from" ? "от " : "";
  return `${prefix}${priceFormatter.format(priceAmount)} ₸${priceUnit ? ` ${priceUnit}` : ""}`;
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
