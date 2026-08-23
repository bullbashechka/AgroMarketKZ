import type {
  AdminCardListResponse,
  AdminCardDetail,
  AdminCategory,
  AdminPlatformSettings,
  AdminUserListResponse,
  CardDetail,
  CardListItem,
  CardListResponse,
  CatalogType,
  CatalogRegionFilter,
  CategoryListItem,
  PlatformSettings,
  PriceFilter,
  ContactCapabilities,
  Request,
  RequestListResponse,
  RequestStatus
} from "@agromarket/contracts";
import { infiniteQueryOptions, keepPreviousData, queryOptions } from "@tanstack/react-query";
import { apiGet, ApiError } from "./api";

export const categoriesQueryOptions = (type: CatalogType) =>
  queryOptions({
    queryKey: ["categories", type] as const,
    queryFn: () => apiGet<CategoryListItem[]>(`/catalog/categories?type=${type}`)
  });

/** Активные категории для предложения объявления, включая ещё пустые. */
export const listingCategoriesQueryOptions = (type: CatalogType) =>
  queryOptions({
    queryKey: ["listing-categories", type] as const,
    queryFn: () => apiGet<CategoryListItem[]>(`/catalog/categories?type=${type}&includeEmpty=true`)
  });

/** Территории для фильтра и форм; справочник меняется редко. */
export const territoriesQueryOptions = queryOptions({
  queryKey: ["territories"] as const,
  queryFn: () => apiGet<import("@agromarket/contracts").Territory[]>("/catalog/territories"),
  staleTime: 60 * 60_000
});

interface CardsQueryParams {
  type: CatalogType;
  categoryId?: string;
  search?: string;
  price?: PriceFilter;
  region: CatalogRegionFilter;
}

function buildCardsQuery(params: CardsQueryParams, offset: number): string {
  const query = new URLSearchParams({ type: params.type, offset: String(offset) });
  if (params.categoryId) query.set("categoryId", params.categoryId);
  if (params.search) query.set("search", params.search);
  if (params.price) query.set("price", params.price);
  query.set("region", params.region);
  return query.toString();
}

/** Постраничный список карточек вкладки/категории с фильтрами (поиск, цена). */
export const cardsInfiniteQueryOptions = (params: CardsQueryParams) =>
  infiniteQueryOptions({
    queryKey: [
      "cards",
      params.type,
      params.categoryId ?? null,
      params.search ?? "",
      params.price ?? null,
      params.region
    ] as const,
    queryFn: ({ pageParam }) => apiGet<CardListResponse>(`/catalog/cards?${buildCardsQuery(params, pageParam)}`),
    initialPageParam: 0,
    getNextPageParam: (lastPage) => lastPage.nextOffset,
    placeholderData: keepPreviousData
  });

/** Полная карточка по id. 404 (снята/не существует) не ретраим — сразу показываем заглушку. */
export const cardDetailQueryOptions = (cardId: string) =>
  queryOptions({
    queryKey: ["card", cardId] as const,
    queryFn: () => apiGet<CardDetail>(`/catalog/cards/${cardId}`),
    retry: (failureCount, error) => !(error instanceof ApiError && error.status === 404) && failureCount < 2
  });

export const favoritesQueryOptions = queryOptions({
  queryKey: ["favorites"] as const,
  queryFn: () => apiGet<CardListItem[]>("/favorites")
});

/** Публичные контакты площадки — меняются редко, кэшируем дольше обычного. */
export const settingsQueryOptions = queryOptions({
  queryKey: ["settings"] as const,
  queryFn: () => apiGet<PlatformSettings>("/settings"),
  staleTime: 5 * 60_000
});

export const contactCapabilitiesQueryOptions = queryOptions({
  queryKey: ["settings-capabilities"] as const,
  queryFn: () => apiGet<ContactCapabilities>("/settings/capabilities"),
  staleTime: 5 * 60_000,
});

// --- Админ ---

interface AdminCardsQueryParams {
  type?: CatalogType;
  categoryId?: string;
  search?: string;
}

function buildAdminCardsQuery(params: AdminCardsQueryParams, offset: number): string {
  const query = new URLSearchParams({ archived: "all", offset: String(offset) });
  if (params.type) query.set("type", params.type);
  if (params.categoryId) query.set("categoryId", params.categoryId);
  if (params.search) query.set("search", params.search);
  return query.toString();
}

/** Постраничный список карточек (админ) — все карточки, включая скрытые. */
export const adminCardsInfiniteQueryOptions = (params: AdminCardsQueryParams) =>
  infiniteQueryOptions({
    queryKey: ["admin-cards", params.type ?? null, params.categoryId ?? null, params.search ?? ""] as const,
    queryFn: ({ pageParam }) =>
      apiGet<AdminCardListResponse>(`/admin/cards?${buildAdminCardsQuery(params, pageParam)}`),
    initialPageParam: 0,
    getNextPageParam: (lastPage) => lastPage.nextOffset,
    placeholderData: keepPreviousData
  });

/** Полная карточка по id (админ — включая скрытые). */
export const adminCardQueryOptions = (cardId: string) =>
  queryOptions({
    queryKey: ["admin-card", cardId] as const,
    queryFn: () => apiGet<AdminCardDetail>(`/admin/cards/${cardId}`),
    retry: (failureCount, error) => !(error instanceof ApiError && error.status === 404) && failureCount < 2
  });

/** Категории вкладки (админ) — включая неактивные, со счётчиками карточек. */
export const adminCategoriesQueryOptions = (type: CatalogType) =>
  queryOptions({
    queryKey: ["admin-categories", type] as const,
    queryFn: () => apiGet<AdminCategory[]>(`/admin/categories?type=${type}`)
  });

/** Постраничный список заявок (админ) по статусу. */
export const adminRequestsInfiniteQueryOptions = (status: RequestStatus) =>
  infiniteQueryOptions({
    queryKey: ["admin-requests", status] as const,
    queryFn: ({ pageParam }) =>
      apiGet<RequestListResponse>(`/admin/requests?status=${status}&offset=${pageParam}`),
    initialPageParam: 0,
    getNextPageParam: (lastPage) => lastPage.nextOffset
  });

/** Заявка по id (админ) — деталка, в т.ч. по deep-link из Telegram-уведомления. */
export const adminRequestQueryOptions = (requestId: string) =>
  queryOptions({
    queryKey: ["admin-request", requestId] as const,
    queryFn: () => apiGet<Request>(`/admin/requests/${requestId}`),
    retry: (failureCount, error) => !(error instanceof ApiError && error.status === 404) && failureCount < 2
  });

/** Счётчик новых заявок для бейджа в «Общее» — без выделенного count-эндпоинта берём первую страницу. */
export const adminNewRequestsBadgeQueryOptions = queryOptions({
  queryKey: ["admin-requests-badge"] as const,
  queryFn: () => apiGet<RequestListResponse>("/admin/requests?status=new&limit=20"),
  select: (data: RequestListResponse) => ({ count: data.items.length, hasMore: data.hasMore }),
  staleTime: 60_000
});

/** Постраничный список зарегистрированных пользователей (админ, read-only). */
export const adminUsersInfiniteQueryOptions = infiniteQueryOptions({
  queryKey: ["admin-users"] as const,
  queryFn: ({ pageParam }) => apiGet<AdminUserListResponse>(`/admin/users?offset=${pageParam}`),
  initialPageParam: 0,
  getNextPageParam: (lastPage) => lastPage.nextOffset,
  placeholderData: keepPreviousData
});

/** Настройки площадки для админа (включая adminChatId). */
export const adminSettingsQueryOptions = queryOptions({
  queryKey: ["admin-settings"] as const,
  queryFn: () => apiGet<AdminPlatformSettings>("/admin/settings")
});
