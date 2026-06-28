import { z } from "zod";
import { cardListItemSchema } from "./card";

/** Добавление/удаление карточки в избранное. */
export const favoriteInput = z.object({
  cardId: z.uuid({ error: "Не указана карточка" })
});

export type FavoriteInput = z.infer<typeof favoriteInput>;

/** Список избранного пользователя — карточки в превью-формате. */
export const favoritesResponse = z.array(cardListItemSchema);
export type FavoritesResponse = z.infer<typeof favoritesResponse>;
