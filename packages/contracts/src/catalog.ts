import { z } from "zod";
import { SEARCH_MAX } from "./constants";
import { cardListItemSchema } from "./card";
import { categorySchema } from "./category";
import { catalogTypeSchema, priceTypeSchema } from "./enums";
import { paginated, paginationQuerySchema } from "./pagination";

/** Список категорий вкладки. */
export const categoryListQuery = z.object({
  type: catalogTypeSchema
});

export const categoryListResponse = z.array(categorySchema);

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
