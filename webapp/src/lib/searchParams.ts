import type {
  CatalogRegionFilter,
  CatalogType,
  CommodityGroup,
  PriceFilter,
  ProductLocation,
  ProductSort,
  ProductOwnershipForm,
  RequestStatus
} from "@agromarket/contracts";

export interface CatalogSearch {
  q?: string;
  price?: PriceFilter;
  region?: CatalogRegionFilter;
  sort?: ProductSort;
  commodityGroups?: CommodityGroup[];
  ownershipForms?: ProductOwnershipForm[];
  productLocation?: ProductLocation | "all";
}

/** `validateSearch` для роутов каталога/категории — из сырых query-параметров URL. */
export function catalogSearchSchema(search: Record<string, unknown>): CatalogSearch {
  const q = typeof search.q === "string" && search.q.trim().length > 0 ? search.q : undefined;
  const price = search.price === "with_price" || search.price === "on_request" ? search.price : undefined;
  const region = typeof search.region === "string" && ["all_regions", "republican_cities", "abay_region", "akmola_region", "aktobe_region", "almaty_region", "atyrau_region", "east_kazakhstan_region", "zhambyl_region", "zhetysu_region", "west_kazakhstan_region", "karaganda_region", "kostanay_region", "kyzylorda_region", "mangystau_region", "pavlodar_region", "north_kazakhstan_region", "turkistan_region", "ulytau_region"].includes(search.region)
    ? search.region as CatalogRegionFilter
    : undefined;
  const sort = search.sort === "price_asc" || search.sort === "volume_asc" ? search.sort : undefined;
  const parseList = <T extends string>(value: unknown, allowed: readonly T[]): T[] | undefined => {
    if (typeof value !== "string") return undefined;
    const result = value.split(",").filter((item): item is T => allowed.includes(item as T));
    return result.length > 0 ? [...new Set(result)] : undefined;
  };
  const commodityGroups = parseList(search.commodityGroups, ["cereals", "oilseeds", "pulses"] as const);
  const ownershipForms = parseList(search.ownershipForms, ["peasant_farm", "llp_vat_agricultural_producer", "llp_trader"] as const);
  const productLocation = search.productLocation === "elevator" || search.productLocation === "seller_site" ? search.productLocation : undefined;
  return { q, price, region, sort, commodityGroups, ownershipForms, productLocation };
}

/** Строит query-строку для каталога; массивы фильтров сохраняются через запятую. */
export function buildSearchQuery(search: CatalogSearch): string {
  const params = new URLSearchParams();
  if (search.q) params.set("q", search.q);
  if (search.price) params.set("price", search.price);
  if (search.region && search.region !== "all_regions") params.set("region", search.region);
  if (search.sort && search.sort !== "default") params.set("sort", search.sort);
  if (search.commodityGroups?.length) params.set("commodityGroups", search.commodityGroups.join(","));
  if (search.ownershipForms?.length) params.set("ownershipForms", search.ownershipForms.join(","));
  if (search.productLocation && search.productLocation !== "all") params.set("productLocation", search.productLocation);
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
