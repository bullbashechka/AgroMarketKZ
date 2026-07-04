import type {
  CardDetail,
  CardListItem,
  CardListResponse,
  CatalogType,
  CategoryListItem,
  PlatformSettings,
  PriceType
} from "@agromarket/contracts";
import { infiniteQueryOptions, keepPreviousData, queryOptions } from "@tanstack/react-query";
import { apiGet, ApiError } from "./api";

export const categoriesQueryOptions = (type: CatalogType) =>
  queryOptions({
    queryKey: ["categories", type] as const,
    queryFn: () => apiGet<CategoryListItem[]>(`/catalog/categories?type=${type}`)
  });

interface CardsQueryParams {
  type: CatalogType;
  categoryId?: string;
  search?: string;
  priceType?: PriceType;
}

function buildCardsQuery(params: CardsQueryParams, offset: number): string {
  const query = new URLSearchParams({ type: params.type, offset: String(offset) });
  if (params.categoryId) query.set("categoryId", params.categoryId);
  if (params.search) query.set("search", params.search);
  if (params.priceType) query.set("priceType", params.priceType);
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
      params.priceType ?? null
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
