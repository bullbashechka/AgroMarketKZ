# Этап 2, задача 1: явная конфигурация пула PostgreSQL

## Цель

Закрепить одинаковые безопасные параметры `postgres.js` в Bun и Cloudflare Worker runtime без подключения к БД и без изменения библиотечного `max_lifetime`.

## Обязательные ограничения

- Работать в текущем workspace и сохранить все существующие пользовательские изменения.
- Не создавать и не переключать ветки, не коммитить, не stage-ить файлы.
- Использовать TDD: сначала тест, затем подтверждённый RED, потом минимальная реализация и GREEN.
- Не читать и не выводить значения `.env` или `DATABASE_URL`.
- Не менять catalog queries, маршруты, контракты, миграции, зависимости, lockfile или `wrangler.toml`.
- Использовать TypeScript ES modules, две позиции отступа, двойные кавычки и точки с запятой.

## Файлы

- Изменить: `backend/src/db.ts`
- Создать: `backend/tests/db.test.ts`

## Приёмочный контракт

1. `backend/src/db.ts` экспортирует `POSTGRES_POOL_OPTIONS` с точными значениями:
   - `max: 3`
   - `idle_timeout: 20`
   - `connect_timeout: 10`
   - `prepare: false`
2. Объект типобезопасно проверяется через публичные типы установленного `postgres@3.4.9` и не использует `any`.
3. `getDb()` передаёт тот же объект в `postgres(databaseUrl, POSTGRES_POOL_OPTIONS)` и сохраняет существующий module-singleton.
4. Поле `max_lifetime` отсутствует: библиотечный randomized default 30–60 минут не переопределяется.
5. Тест проверяет exact object equality и отсутствие собственного `max_lifetime`; реальное соединение с БД не открывается.

## TDD-порядок

1. Создать `backend/tests/db.test.ts`, импортирующий ещё не существующий `POSTGRES_POOL_OPTIONS` и проверяющий точный объект и отсутствие `max_lifetime`.
2. Выполнить `cmd.exe /d /c bun test backend/tests/db.test.ts` и зафиксировать ожидаемый RED из-за отсутствующего export.
3. Добавить минимальную реализацию в `backend/src/db.ts`. Предпочтительная форма — `Object.freeze({...}) satisfies postgres.Options<...>` с публичными типами пакета; не вводить DI или фабрики только ради теста.
4. Повторить `cmd.exe /d /c bun test backend/tests/db.test.ts` и получить GREEN.
5. Выполнить `cmd.exe /d /c bun run --cwd backend typecheck`.

## Отчёт

Полный отчёт записать через `apply_patch` в `.superpowers/sdd/stage2-task1-report.md`:

- изменённые файлы;
- RED-команда и существенная ожидаемая ошибка;
- GREEN-команда и итог;
- typecheck-команда и итог;
- self-review;
- риски или сомнения.

В финальном сообщении вернуть только статус `DONE`, `DONE_WITH_CONCERNS`, `BLOCKED` или `NEEDS_CONTEXT`, одну строку проверок, concerns и путь отчёта. Коммиты не создавать.
