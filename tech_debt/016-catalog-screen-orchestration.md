# TD-016 — Общая orchestration-модель каталога

**Приоритет:** P2  
**Этап:** 1  
**Оценка:** M  
**Зависимости:** TD-008; делать вместе с ближайшим изменением catalog filters.

## Проблема

`CatalogTab` и `CategoryScreen` повторяют части поиска, filters/sort, URL state, loading/empty/error и CTA. Дублирование ещё терпимо, но при следующем filter/sort легко получить разное поведение root и category journeys.

## План

1. Зафиксировать behavior matrix: initial URL, back/forward, category enter/leave, filter reset, search debounce, sort, retry, publish-return refresh.
2. **Red:** pure tests URL/query-state serialization и component tests orchestration transitions.
3. Выделить узкий `useCatalogController` или pure query-state module только для общей механики; экраны сохраняют различную композицию/копирайтинг.
4. Использовать query-key factory TD-008; не вводить global store. Проверить Telegram deep links и native back вручную.

## Критерии приёмки

- Одинаковые фильтры имеют одну serialization/default/reset семантику.
- Root/category сохраняют свои UX-различия без conditional god-hook.
- Back/deep link/cache recovery детерминированы и покрыты.
- Extraction уменьшает реальные дубли, а не просто добавляет wrapper.

## Проверка

Pure/component tests, `bun run typecheck`, targeted Playwright catalog journeys, ручной Telegram back/deep-link smoke.

## Вероятные файлы

`webapp/src/screens/CatalogTab.tsx`, `CategoryScreen.tsx`, query helpers, route/search-param tests.
