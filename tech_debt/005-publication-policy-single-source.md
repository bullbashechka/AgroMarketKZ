# TD-005 — Единая политика публикации и видимости карточек

**Приоритет:** P1  
**Этап:** 1  
**Оценка:** M  
**Зависимости:** выполнить перед TD-006/007 и Stage 2 catalog variants.

## Проблема и доказательства

Готовность к публикации имеет две независимые application-level реализации:

- `publishCardInput` refinements — `packages/contracts/src/card.ts:215-244`;
- строковый `getPublicationIssues()` — `packages/contracts/src/publication.ts:31-76`;

`webapp/src/lib/publicationChecklist.ts:39-81` уже является адаптером: content rules делегирует `getPublicationIssues`, а сам добавляет client-only category/upload состояния. Его нужно сохранить адаптером, не называть третьей policy.

Редактор сначала парсит publish schema, затем отдельно блокирует по live issues. Backend вручную собирает `PublicationCandidate` в нескольких read/write paths `adminCatalog.ts`. SQL constraints — оправданная последняя линия целостности, но application decisions могут разойтись по path/message/allowed behavior.

Отдельный predicate публичности `published_at is not null and archived_at is null` повторён в catalog, favorites, requests и admin category checks. Сейчас копии совпадают, но нет cross-repository contract test.

## Цель

- Один application-level rule set возвращает структурированные нарушения `{ code, path, message }`.
- Zod publish schema и live UI адаптируют одну политику, не повторяют решение.
- DB constraints остаются независимым safety net.
- Видимость карточки одинакова для catalog detail/list, favorites и создания request.

## TDD-план

1. Составить decision table: product/service × commodity/non-commodity × draft/published × price variants × geography × uploads/specs.
2. **Red equivalence tests:** для каждой строки Zod publish result и publication policy result должны совпадать по допустимости и field path.
3. Изменить policy result со `string[]` на typed issues. Стабильные codes нужны UI и API; Russian message остаётся presentation-friendly.
4. `publishCardInput.superRefine` делегирует rule set. Избежать рекурсивного parse; выделить normalized candidate.
5. UI wrapper добавляет только client-only состояния: category loading/error/not found, image pending/upload error. Content rules не копируются.
6. Backend создаёт candidate одним mapper/read-model helper, а не четырьмя ручными literals.
7. Добавить isolated integration contract видимости (это отдельный predicate contract, не часть publication mapper):
   - draft/archived отсутствует в public list/detail/favorites add и request availability;
   - published active доступен везде;
   - category counts используют ту же семантику.
8. Документировать различие: UX policy vs DB integrity constraints.

## Критерии приёмки

- Нет двух независимых application-level реализаций product/service publication rules.
- Issues имеют stable code/path/message и дедуплицируются детерминированно.
- Live checklist не может показать green, когда backend policy блокирует при одинаковом persisted candidate.
- SQL constraint error продолжает маппиться в безопасный actionable 4xx.
- Cross-repository visibility test защищает catalog/favorites/request consistency.

## Проверка

```sh
bun test packages/contracts/tests/schemas.test.ts backend/tests/publication.test.ts webapp/tests/publicationChecklist.test.ts
bun run test:integration
bun run typecheck
bun run test:e2e
```

## Ловушки

- Не переносить DB lookup категории внутрь pure contracts package; передавать `categoryIsCommodity` как verified context.
- Не пытаться выразить все SQL constraints в Zod один-в-один: разные trust boundaries.
- Сохранить draft permissiveness: create/update draft не должны требовать publish completeness.
- Не вводить state-machine library для трёх состояний.

## Вероятные файлы

`packages/contracts/src/publication.ts`, `packages/contracts/src/card.ts`, contract tests, `webapp/src/lib/publicationChecklist.ts`, `backend/src/repos/adminCatalog.ts` или будущий card policy mapper, repository integration tests.
