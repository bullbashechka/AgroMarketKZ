/** Результат постраничной выдачи (load-more). */
export interface PaginatedResult<T> {
  items: T[];
  hasMore: boolean;
  nextOffset: number | null;
}

/**
 * Разбирает результат SQL-запроса с `limit + 1` строк на страницу ответа:
 * лишняя строка (если есть) отбрасывается и служит признаком `hasMore`.
 */
export function paginateRows<T>(rows: T[], limit: number, offset: number): PaginatedResult<T> {
  const hasMore = rows.length > limit;
  return {
    items: hasMore ? rows.slice(0, limit) : rows,
    hasMore,
    nextOffset: hasMore ? offset + limit : null
  };
}
