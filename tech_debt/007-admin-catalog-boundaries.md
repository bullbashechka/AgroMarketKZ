# TD-007 — Разделение adminCatalog и единый card read model

**Приоритет:** P1  
**Этап:** 1  
**Оценка:** M  
**Зависимости:** TD-001, TD-005; координировать с TD-006.
**Статус:** выполнено 27.08.2026 (независимый review: 9/10; P2 coverage устранено).

## Проблема и граница

`backend/src/repos/adminCatalog.ts` (1126 строк) объединяет category CRUD, list/detail, create/update/delete, publish/archive, SQL projection, publication candidate mapping и error translation. Его внутренние row types уже используются соседними repository-модулями. Это god-repository: изменения полей требуют правок в нескольких projections/mappers, а транзакционные границы трудно увидеть.

Цель — разделить по текущим use cases, сохранив SQL-first подход. Не входят generic repository, ORM migration, «service layer» без поведения и один файл на каждую функцию.

## TDD-план

1. **Red:** integration characterization tests для list/detail/create/update/publish/archive/delete/category-in-use, ownership и DB constraint mapping.
2. Выделить общий минимальный `CardRow` и отдельные явные `toCardDto`/`toPublicationCandidate`; объединять только доказанно одинаковую nullable normalization. Не экспортировать admin-specific wide row соседям.
3. Разделить модуль на две-три cohesive границы: categories; card reads; card writes/lifecycle. Транзакционные use cases остаются рядом с SQL, который обязан быть атомарным.
4. Вынести publication candidate mapping по TD-005; централизовать повторяющиеся selected columns/predicate только если это предотвращает реальное расхождение.
5. После каждого extraction запускать characterization tests; удалять старые exports сразу, без compatibility wrapper поверх самого себя.

## Критерии приёмки

- Category и card lifecycle меняются независимо; public/favorites/request repos не импортируют admin-internal types.
- DTO и publication candidate имеют отдельные mappers с общей только доказанно одинаковой normalization.
- Transaction ownership и authorization inputs видны на уровне каждой write-функции.
- SQL остаётся конкретным и читаемым; нет универсального query builder.

## Проверка и ловушки

```sh
bun test backend/tests/adminCatalog.test.ts backend/tests/appSecurity.test.ts
bun run test:integration
bun run typecheck
```

Не делать механическое разбиение без tests; не создавать циклические imports через «shared». Изменение SQL projections требует contract/API snapshot checks.

## Вероятные файлы

`backend/src/repos/adminCatalog.ts`, `backend/src/repos/catalog.ts`, `favorites.ts`, `requests.ts`, новые узкие catalog repo modules, integration tests.

## Итоговое решение

`adminCategories` владеет category CRUD и счётчиками, `adminCardReads` —
админскими list/detail projections, а `adminCatalog` оставлен только для
атомарного card lifecycle. Policy-модуль содержит явные adapters из input,
persisted row, admin list и detail в `PublicationCandidate`; DTO mapping и
policy candidate больше не смешиваются. Интеграционные проверки покрывают
category CRUD/list, create/update/publish/archive/delete, category-in-use,
actor-owned upload claims и parity review state между list/detail.
