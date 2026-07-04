import type { PriceType } from "@agromarket/contracts";

export interface CatalogSearch {
  q?: string;
  price?: PriceType;
}

/** `validateSearch` для роутов каталога/категории — из сырых query-параметров URL. */
export function catalogSearchSchema(search: Record<string, unknown>): CatalogSearch {
  const q = typeof search.q === "string" && search.q.trim().length > 0 ? search.q : undefined;
  const price = search.price === "fixed" || search.price === "on_request" ? search.price : undefined;
  return { q, price };
}

/** Строит query-строку `?q=...&price=...` (пустая, если оба параметра не заданы). */
export function buildSearchQuery(search: CatalogSearch): string {
  const params = new URLSearchParams();
  if (search.q) params.set("q", search.q);
  if (search.price) params.set("price", search.price);
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}
