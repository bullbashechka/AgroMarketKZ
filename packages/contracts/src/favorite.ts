import { z } from "zod";
import { cardListItemSchema } from "./card";
import { PAGE_SIZE_DEFAULT, PAGE_SIZE_MAX } from "./constants";

/** Добавление/удаление карточки в избранное. */
export const favoriteInput = z.object({
  cardId: z.uuid({ error: "Не указана карточка" })
});

export type FavoriteInput = z.infer<typeof favoriteInput>;

/** Query для keyset-пагинации избранного; курсор выдаёт только сервер. */
export const favoritesPageQuery = z.object({
  pagination: z.literal("cursor"),
  cursor: z.string().min(1).max(256).optional(),
  limit: z.coerce.number().int().min(1).max(PAGE_SIZE_MAX).default(PAGE_SIZE_DEFAULT),
});
export type FavoritesPageQuery = z.infer<typeof favoritesPageQuery>;

/** Bounded page избранного пользователя — карточки в preview-формате. */
export const favoritesResponse = z.object({
  items: z.array(cardListItemSchema),
  nextCursor: z.string().min(1).max(256).nullable(),
});
export type FavoritesResponse = z.infer<typeof favoritesResponse>;

/** Запрашиваем только membership для уже видимой bounded пачки карточек. */
export const favoriteMembershipQuery = z.object({
  cardIds: z.string().transform((value) => value.split(",")).pipe(
    z.array(z.uuid()).min(1).max(PAGE_SIZE_MAX).refine((ids) => new Set(ids).size === ids.length),
  ),
});
export type FavoriteMembershipQuery = z.infer<typeof favoriteMembershipQuery>;

export const favoriteMembershipResponse = z.object({ favoriteIds: z.array(z.uuid()) });
export type FavoriteMembershipResponse = z.infer<typeof favoriteMembershipResponse>;
