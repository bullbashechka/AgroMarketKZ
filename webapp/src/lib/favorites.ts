import type { CardListItem } from "@agromarket/contracts";
import { type InfiniteData, useMutation, useQueries, useQueryClient } from "@tanstack/react-query";
import type { FavoriteMembershipResponse, FavoritesResponse } from "@agromarket/contracts";
import { apiDelete, apiGet, apiPost } from "./api";
import { useAuth } from "./auth";
import { catalogQueryKeys, favoritesInfiniteQueryOptions } from "./queries";
import { hapticImpactLight } from "./telegram";

const membershipKeyPrefix = [...catalogQueryKeys.favorites, "membership"] as const;

/** Множество избранных id только для уже видимой bounded-пачки карточек. */
export function useFavoriteIds(cardIds: string[]): Set<string> {
  const { profile } = useAuth();
  const ids = [...new Set(cardIds)].sort();
  const chunks = Array.from({ length: Math.ceil(ids.length / 50) }, (_value, index) => ids.slice(index * 50, (index + 1) * 50));
  const queries = useQueries({
    queries: chunks.map((chunk) => ({
      queryKey: [...membershipKeyPrefix, chunk.join(",")],
      queryFn: () => apiGet<FavoriteMembershipResponse>(`/favorites/membership?${new URLSearchParams({ cardIds: chunk.join(",") })}`),
      enabled: profile?.isRegistered === true,
    })),
  });
  return new Set(queries.flatMap((query) => query.data?.favoriteIds ?? []));
}

/** Один card detail вне list получает такую же bounded (из одного id) membership-проверку. */
export function useIsFavorite(cardId: string, known?: boolean): boolean {
  const ids = useFavoriteIds(known === undefined ? [cardId] : []);
  return known ?? ids.has(cardId);
}

/**
 * Optimistic add/remove из избранного. `item` нужен для мгновенной вставки в кэш списка
 * (карточка ещё не может быть в кэше избранного, если её туда добавляют впервые).
 */
export function useToggleFavorite() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({ item, isFavorite }: { item: CardListItem; isFavorite: boolean }) => {
      if (isFavorite) {
        await apiDelete(`/favorites/${item.id}`);
      } else {
        await apiPost("/favorites", { cardId: item.id });
      }
    },
    onMutate: async ({ item, isFavorite }) => {
      hapticImpactLight();
      await qc.cancelQueries({ queryKey: favoritesInfiniteQueryOptions.queryKey });
      const previous = qc.getQueryData<InfiniteData<FavoritesResponse>>(favoritesInfiniteQueryOptions.queryKey);
      const previousMembership = qc.getQueriesData<FavoriteMembershipResponse>({ queryKey: membershipKeyPrefix });
      qc.setQueryData<InfiniteData<FavoritesResponse>>(favoritesInfiniteQueryOptions.queryKey, (current) => {
        if (!current) return current;
        return {
          ...current,
          pages: current.pages.map((page, index) => ({
            ...page,
            items: isFavorite
              ? page.items.filter((candidate) => candidate.id !== item.id)
              : index === 0 ? [item, ...page.items.filter((candidate) => candidate.id !== item.id)] : page.items,
          })),
        };
      });
      for (const [key, page] of previousMembership) {
        const requestedIds = key.at(-1);
        if (!page || typeof requestedIds !== "string" || !requestedIds.split(",").includes(item.id)) continue;
        qc.setQueryData<FavoriteMembershipResponse>(key, {
          favoriteIds: isFavorite
            ? page.favoriteIds.filter((id) => id !== item.id)
            : [...new Set([...page.favoriteIds, item.id])],
        });
      }
      return { previous, previousMembership };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) qc.setQueryData(favoritesInfiniteQueryOptions.queryKey, context.previous);
      for (const [key, page] of context?.previousMembership ?? []) qc.setQueryData(key, page);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: favoritesInfiniteQueryOptions.queryKey });
    }
  });
}
