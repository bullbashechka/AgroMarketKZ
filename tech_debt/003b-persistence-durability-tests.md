# TD-003B — Durability tests для outbox, audit и privacy

**Приоритет:** P0 · **Оценка:** M · **Зависимости:** isolated Postgres harness; согласовать DB scope с TD-001.

**Статус:** ✅ Выполнено (2026-08-26; финальный независимый code review: 9/10, actionable замечаний нет).

## Фактическое выполнение

- Изолированный PostgreSQL runner создаёт временный кластер, накатывает все migrations и теперь умеет безопасно выбрать только allowlisted persistence suite через `INTEGRATION_TEST_FILES`.
- Реальные DB tests подтверждают outbox lease fencing, retry/DLQ, reconciliation и ограничение batch; audit success/denied/failed/PII policy и post-commit recovery; privacy hold, retention boundaries, 100-row batch и resume после race.
- Исправлены fixtures, скрывавшие доказательство: UUID-массивы явно приводятся к `uuid[]`, session timestamps сохраняют DB constraint `expires_at > created_at`, а legal-hold race ждёт фактический INSERT перед retention.

### Проверка выполнения

- `bun run test:integration` — успешно: catalog 15, sessions 9, notification outbox 9, admin audit 9, privacy 5.
- `bun run typecheck` — успешно.
- `git diff --check` — успешно.

## Проблема

Coverage snapshot: `notificationOutbox.ts` 7.24%, `privacy.ts` 2.86%, `sessions.ts` 6.33%. Audit middleware запускается после admin guard и записывает после `await next()`: denied/failed outcomes не фиксируются, а audit INSERT после committed mutation может превратить успех в неоднозначный 500. Обычный suite пропускает 17 DB tests без `TEST_DATABASE_URL`.

## TDD-план

1. **Outbox Red:** concurrent claim, sent/failure/next-attempt, lost enqueue reconciliation, duplicate delivery receipt и terminal/DLQ-ready state.
2. **Audit Red:** success, non-admin denied, handler 4xx/5xx, PII-read; body/secrets отсутствуют. Для mutation выбрать одну семантику: та же transaction либо durable audit outbox. Audit failure не создаёт misleading retry после commit.
3. **Privacy Red:** legal hold, retention boundary, bounded batch, atomic/idempotent delete и resume after failure.
4. Integration command создаёт isolated DB либо явно fail-ит precondition; скрытые skips не считаются доказательством.

## Критерии приёмки

- State transitions и concurrency защищены DB integration tests.
- Audit имеет success/denied/failed policy без PII и неоднозначного committed-then-500 пути.
- Retention/delete восстанавливаются после partial failure.
- Быстрый suite честно сообщает, что persistence доказательство не запускалось.

## Проверка

```sh
bun run test:integration
bun test backend/tests/adminAudit.test.ts backend/tests/notificationOutbox.test.ts backend/tests/privacy.test.ts
bun run typecheck
```

Не делать E2E единственной защитой чистых recovery transitions и не мокать transaction/concurrency, которые обязан доказать PostgreSQL.
