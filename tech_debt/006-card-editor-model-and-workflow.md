# TD-006 — TDD-рефакторинг модели и workflow редактора карточки

**Приоритет:** P1  
**Этап:** 1  
**Оценка:** M  
**Зависимости:** TD-004, TD-005.

## Проблема и граница

`webapp/src/screens/admin/CardEditorScreen.tsx` — 1095 строк и около 30 локальных состояний. Экран одновременно восстанавливает draft, нормализует API-данные, управляет uploads, собирает payload, вычисляет publication checklist/preview и рисует все секции. Любое новое поле затрагивает несколько несвязанных веток и легко создаёт расхождение между draft, preview и save.

Цель — не «идеальная форма», а один тестируемый editor model и несколько секций с узкими props. Не входят form/state-machine library, новый global store и визуальный redesign.

## TDD-план

1. **Red:** table tests для pure переходов: load create/edit, восстановление draft, смена product/service/category, ручное изменение shared phone, add/remove/reorder upload, save success/error и publish readiness.
2. Выделить `cardEditorModel` с одним `EditorState`, явными actions и селекторами `toDraft`, `toMutationInput`, `toPreview`. Серверный DTO нормализовать один раз на входе.
3. Оставить в screen orchestration: queries/mutations, navigation, Telegram UI и composition. Вынести секции только там, где появляется самостоятельный контракт (`Basics`, `Pricing`, `Location`, `Media`, `Publication`).
4. Сохранить текущую draft-version/recovery семантику; для несовместимого draft использовать явную миграцию или отказ с понятным сообщением.
5. Добавить component tests лишь для связок, которые pure model не доказывает: pending upload blocks save, API error сохраняет ввод, successful save очищает recovery draft.

## Критерии приёмки

- DTO → editor state → mutation/preview имеет один путь и round-trip tests.
- Product/service/commodity поля очищаются или сохраняются по одной decision table.
- Screen больше не содержит полную business-normalization/payload логику и становится заметно меньше без искусственного лимита строк.
- Loading/error/retry, double-submit, unsaved changes, upload failure и back navigation не регрессируют.
- Нет нового dependency или generic form framework.

## Проверка и ловушки

```sh
bun test webapp/tests/cardEditorModel.test.ts webapp/tests/publicationChecklist.test.ts
bun run typecheck
bun run test:e2e
```

Не дробить JSX на компоненты без собственной ответственности; это только перенос строк. Не менять API contract одновременно с механическим extraction. Ручной Telegram smoke обязателен для BackButton, native contact и upload.

## Вероятные файлы

`webapp/src/screens/admin/CardEditorScreen.tsx`, новый `webapp/src/lib/cardEditorModel.ts`, небольшие `webapp/src/components/card-editor/*`, tests.
