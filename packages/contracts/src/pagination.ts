import { z } from "zod";
import { PAGE_SIZE_DEFAULT, PAGE_SIZE_MAX } from "./constants";

/**
 * Параметры пагинации для списков (load-more). `coerce` — потому что в query-строке
 * значения приходят строками.
 */
export const paginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(PAGE_SIZE_MAX).default(PAGE_SIZE_DEFAULT),
  offset: z.coerce.number().int().min(0).default(0)
});

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

/** Обёртка ответа со списком: элементы + признак «есть ещё» + смещение для подгрузки. */
export const paginated = <T extends z.ZodTypeAny>(item: T) =>
  z.object({
    items: z.array(item),
    hasMore: z.boolean(),
    nextOffset: z.number().int().nullable()
  });
