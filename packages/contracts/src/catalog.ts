import { z } from "zod";
import { SEARCH_MAX } from "./constants";
import { cardListItemSchema } from "./card";
import { categorySchema, categoryListItemSchema } from "./category";
import { catalogTypeSchema, priceTypeSchema } from "./enums";
import { paginated, paginationQuerySchema } from "./pagination";

/** Список категорий вкладки. */
export const categoryListQuery = z.object({
  type: catalogTypeSchema
});

/** Список категорий (админ, включая неактивные и пустые). */
export const categoryListResponse = z.array(categorySchema);

/** Список категорий вкладки для пользователей — только с опубликованными карточками (пустые скрыты). */
export const categoryListItemResponse = z.array(categoryListItemSchema);

/**
 * Каталог карточек. Гибридная навигация:
 * - `type` — обязателен (вкладка «Товары»/«Услуги»);
 * - `categoryId` — необязательный фильтр (тап по категории);
 * - `search` — необязательный, охватывает всю вкладку (пустой → не фильтрует);
 * - `priceType` — необязательный фильтр «есть цена» / «по запросу».
 * Все фильтры комбинируются по И.
 */
export const cardListQuery = paginationQuerySchema.extend({
  type: catalogTypeSchema,
  categoryId: z.uuid().optional(),
  search: z
    .string()
    .trim()
    .max(SEARCH_MAX)
    .optional()
    .transform((value) => (value && value.length > 0 ? value : undefined)),
  priceType: priceTypeSchema.optional()
});

export type CardListQuery = z.infer<typeof cardListQuery>;

export const cardListResponse = paginated(cardListItemSchema);
export type CardListResponse = z.infer<typeof cardListResponse>;
