import type { CatalogType, PriceFilter, RequestStatus } from "@agromarket/contracts";

export interface CatalogSearch {
  q?: string;
  price?: PriceFilter;
}

/** `validateSearch` для роутов каталога/категории — из сырых query-параметров URL. */
export function catalogSearchSchema(search: Record<string, unknown>): CatalogSearch {
  const q = typeof search.q === "string" && search.q.trim().length > 0 ? search.q : undefined;
  const price = search.price === "with_price" || search.price === "on_request" ? search.price : undefined;
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

export interface AdminCardsSearch {
  type?: CatalogType;
  categoryId?: string;
  q?: string;
}

/** `validateSearch` для `/admin/cards`. */
export function adminCardsSearchSchema(search: Record<string, unknown>): AdminCardsSearch {
  const type = search.type === "product" || search.type === "service" ? search.type : undefined;
  const categoryId = typeof search.categoryId === "string" && search.categoryId.length > 0 ? search.categoryId : undefined;
  const q = typeof search.q === "string" && search.q.trim().length > 0 ? search.q : undefined;
  return { type, categoryId, q };
}

/** Строит query-строку для `/admin/cards`. */
export function buildAdminCardsQuery(search: AdminCardsSearch): string {
  const params = new URLSearchParams();
  if (search.type) params.set("type", search.type);
  if (search.categoryId) params.set("categoryId", search.categoryId);
  if (search.q) params.set("q", search.q);
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export interface AdminTypeSearch {
  type?: CatalogType;
}

/** `validateSearch` для `/admin/categories` и `/admin/cards/new` — только предвыбор типа. */
export function adminTypeSearchSchema(search: Record<string, unknown>): AdminTypeSearch {
  const type = search.type === "product" || search.type === "service" ? search.type : undefined;
  return { type };
}

export interface AdminRequestsSearch {
  status?: RequestStatus;
}

const requestStatuses: RequestStatus[] = ["new", "in_progress", "closed"];

/** `validateSearch` для `/admin/requests` — вкладка статуса. */
export function adminRequestsSearchSchema(search: Record<string, unknown>): AdminRequestsSearch {
  const status = requestStatuses.includes(search.status as RequestStatus)
    ? (search.status as RequestStatus)
    : undefined;
  return { status };
}
