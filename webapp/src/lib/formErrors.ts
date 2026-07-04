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
