# TD-013 — Выровнять документацию, env и исторический backlog

**Приоритет:** P1  
**Этап:** 1  
**Оценка:** S  
**Зависимости:** сверить после TD-002/004/012, если они уже внедрены.

## Проблема

README/TASKS/backend README местами продолжают описывать custom JWT/localStorage, хотя runtime использует opaque sessions/cookies. В `TASKS.md` остаются unchecked security пункты, которые код уже реализует (one-time widget proof, audit, storage validation, CSP/no-store и др.), рядом с реальным незакрытым phone-verification defect. Generated Worker env types содержат устаревшие names. Такой backlog заставляет повторно расследовать закрытое и скрывает реальные риски.

## План

1. Построить evidence table: документированное утверждение → current code/config/test → status `done/current/stale/unknown`.
2. Обновить auth/session, deployment topology, DB migration path, test commands и manual Telegram limits. Закрытые пункты помечать с evidence, не удалять историю решения без необходимости.
3. Разделить product roadmap и tech debt: `TASKS.md` ссылается на этот реестр, но не дублирует все описания.
4. Удалить stale generated env types только через официальный generator/build source; добавить config/type drift check.
5. Проверить ссылки/commands и выполнить секрет-redaction review diff.

## Критерии приёмки

- Новый инженер по README запускает фактическую session/DB/deploy архитектуру, а не legacy JWT flow.
- TASKS не показывает реализованный security work как открытый и не скрывает подтверждённые defects.
- Env examples/types соответствуют bindings, required/optional и production validation.
- Один факт имеет один durable owner doc; остальные документы ссылаются.

## Проверка

Запустить все изменённые safe/read-only commands, `bun run typecheck`, link/path checks и ручной diff на secrets. Не выполнять deploy/migration ради проверки документации.

## Вероятные файлы

`README.md`, `backend/README.md`, `TASKS.md`, `DEPLOYMENT.md`, `.env.example`, generated Worker types/source.
