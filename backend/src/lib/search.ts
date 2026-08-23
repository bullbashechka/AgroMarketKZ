/**
 * Экранирует спецсимволы Postgres `LIKE`/`ILIKE` (`\`, `%`, `_`) в пользовательском
 * вводе, чтобы поиск по подстроке не интерпретировал их как шаблон.
 * Обратный слэш экранируется первым, иначе экранирование `%`/`_` задвоится.
 */
export function escapeLike(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

/** Каноническое написание категории и поисковых запросов. */
export function normalizeCatalogText(value: string): string {
  return value.replace(/маслянич/giu, (match) => {
    if (match === match.toLocaleUpperCase("ru")) return "МАСЛИЧ";
    return match[0] === match[0]?.toLocaleUpperCase("ru") ? "Маслич" : "маслич";
  });
}
