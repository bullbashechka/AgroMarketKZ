# TD-015 — Пагинация избранного

**Приоритет:** P2  
**Этап:** 1  
**Оценка:** S  
**Зависимости:** TD-005 для public predicate; TD-008 для query keys.

## Проблема

Favorites остаётся явно неограниченным пользовательским list endpoint. По мере роста он увеличивает DB work, response и render cost. Это локальный долг, не повод менять пагинацию всего каталога.

## План

1. Измерить текущую distribution количества favorites; выбрать разумный default/max page size.
2. **Red contract/integration tests:** empty/first/next page, stable order при одинаковом timestamp, archived/deleted card исчезает, no duplicates при add/remove между страницами.
3. Добавить backward-compatible pagination envelope/cursor; на UI — infinite/load-more с сохранением empty/error/retry.
4. Индекс добавлять только после `EXPLAIN (ANALYZE, BUFFERS)` на representative data.

## Критерии приёмки

- Response bounded; ordering deterministic; cursor opaque и валидируется.
- Visibility совпадает с catalog policy.
- Invalidation add/remove не оставляет duplicate/stale cards.
- Existing small-list UX не становится тяжелее.

## Проверка

Contracts, repository integration, UI query tests и E2E favorite add/load-more/remove. Не делать generic pagination framework и не переходить все offset endpoints без метрик.

## Вероятные файлы

Favorites contracts/route/repo, webapp favorites screen/query, migration только если EXPLAIN требует индекс.
