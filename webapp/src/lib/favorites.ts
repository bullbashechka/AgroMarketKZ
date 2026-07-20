import type { CardListItem } from "@agromarket/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiDelete, apiPost } from "./api";
import { useAuth } from "./auth";
import { favoritesQueryOptions } from "./queries";
import { hapticImpactLight } from "./telegram";

/** Множество id избранных карточек — единый источник правды для сердечка на любом экране. */
export function useFavoriteIds() {
  const { profile } = useAuth();
  return useQuery({
    ...favoritesQueryOptions,
    enabled: profile?.isRegistered === true,
    select: (items) => new Set(items.map((item) => item.id))
  });
}

export function useIsFavorite(cardId: string): boolean {
  const { data } = useFavoriteIds();
  return data?.has(cardId) ?? false;
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
      await qc.cancelQueries({ queryKey: favoritesQueryOptions.queryKey });
      const previous = qc.getQueryData<CardListItem[]>(favoritesQueryOptions.queryKey);
      qc.setQueryData<CardListItem[]>(favoritesQueryOptions.queryKey, (current) => {
        const list = current ?? [];
        return isFavorite ? list.filter((c) => c.id !== item.id) : [item, ...list];
      });
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) qc.setQueryData(favoritesQueryOptions.queryKey, context.previous);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: favoritesQueryOptions.queryKey });
    }
  });
}
