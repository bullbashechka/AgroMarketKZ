# TD-008 — Типизированная API и cache boundary

**Приоритет:** P1  
**Этап:** 1  
**Оценка:** M  
**Зависимости:** TD-003A для proxy boundary.
**Статус:** выполнено 27.08.2026 (два независимых review-прохода; финальный P1 recovery исправлен и покрыт тестом).

## Проблема

`webapp/src/lib/api.ts` доверяет JSON через `payload as T`: shared TypeScript types не валидируют runtime response. Query keys и invalidation собираются raw arrays по экранам. Несовместимый backend response может дать поздний UI crash или stale cache без локализованной boundary-ошибки.

## Минимальное решение

1. Составить inventory endpoints и выбрать сначала mutation/auth/admin critical responses; не валидировать «всё сразу».
2. **Red:** contract tests на valid response, malformed envelope/data, stable API error и older/newer optional fields.
3. Для выбранных endpoints экспортировать response Zod schemas из contracts и парсить на client boundary. Ошибка parse получает безопасный telemetry code, без payload/PII.
4. Создать небольшой query-key factory по доменам и рядом определить invalidate rules; мигрировать по feature, без wrapper над TanStack Query.
5. Мигрировать по одному domain vertical slice и удалить старые raw keys/casts в затронутом slice; proxy protocol принадлежит TD-003A, release descriptor — TD-207.

## Критерии приёмки

- Critical responses проверяются runtime schema; `as T` не является boundary validation.
- Malformed response даёт контролируемую ошибку и recovery UI, а не поздний crash.
- Query invalidation не зависит от разбросанных строковых массивов.
- Schemas остаются API-boundary моделями, не копируют DB rows.

## Проверка и ловушки

```sh
bun test packages/contracts/tests webapp/tests e2e/helpers
bun run typecheck
bun run build
```

Не требовать exact-object schema там, где additive backend fields должны быть совместимы. Не делать codegen/новый API client framework. Сначала auth/profile/catalog mutations, затем остальное при касании.

## Вероятные файлы

`packages/contracts/src/*`, `webapp/src/lib/api.ts`, query modules/screens и их tests.

## Итоговое решение

Для auth/profile и admin catalog-card critical slice клиент теперь вызывает
`safeParse` существующих contract schemas на response boundary. Некорректный
успешный payload становится безопасной `INVALID_API_RESPONSE`, а auth recovery
не использует retained cached profile после failed refetch. Catalog query keys и
invalidation rules живут рядом с query options: lifecycle mutation инвалидирует
все изменяемые публичные и admin lists, включая favorites и listing categories.
Тесты покрывают additive payload, malformed success/error response, cached
profile recovery и набор invalidate keys.
