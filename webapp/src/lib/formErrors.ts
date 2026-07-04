/** Минимальная структура ошибки zod, без прямой зависимости webapp от пакета `zod`. */
interface FlatZodError {
  issues: Array<{ path: PropertyKey[]; message: string }>;
}

/** Ошибки zod-парсинга по полям верхнего уровня — `{ contactPhone: "…", comment: "…" }`. */
export function zodFieldErrors(error: FlatZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "");
    if (key && !(key in fields)) fields[key] = issue.message;
  }
  return fields;
}

/**
 * Ошибки zod-парсинга по полному пути — `{ "specs.0.key": "…", "images": "…" }`.
 * Нужен для форм с вложенными массивами (редактор карточки), где `zodFieldErrors`
 * не различает ошибку конкретной строки specs/images от ошибки всего списка.
 */
export function zodFieldErrorsByPath(error: FlatZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.length > 0 ? issue.path.join(".") : "form";
    if (!(key in fields)) fields[key] = issue.message;
  }
  return fields;
}
