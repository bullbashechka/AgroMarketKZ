# TD-011 — Надёжность Storage, Telegram и maintenance I/O

**Приоритет:** P1  
**Этап:** 1  
**Оценка:** M  
**Зависимости:** TD-003A, TD-010.

## Проблема

Storage fetch paths не имеют единой явной timeout/response-size политики; Telegram уже ограничен примерно 10 секундами. Daily maintenance запускает cleanup, backup и privacy jobs вместе; backup обходит до 200 объектов последовательно, cleanup — до 2000, privacy — до 100 транзакций. Один медленный upstream может съесть Worker execution window, а общий error не показывает, какой item безопасно повторить.

## План

1. Инвентаризировать каждый outbound call: timeout, максимальный body, retry class, idempotency, concurrency и observable outcome.
2. **Red:** fake-clock/fetch tests timeout, abort, non-2xx, malformed/oversized body, 429/5xx с bounded retry+jitter и client 4xx без retry.
3. Добавить маленький shared fetch policy только для действительно общих механик (AbortSignal, size cap, classified error); доменная обработка остаётся в Telegram/Storage clients.
4. Для maintenance задать per-job deadline, bounded concurrency и resumable cursor/checkpoint. Не начинать новый batch, если budget почти исчерпан.
5. Queue/scheduled handler всегда await/`waitUntil` обещания; outcome включает processed/failed/remaining и checkpoint, но не PII.

## Критерии приёмки

- Ни один внешний вызов не ждёт бесконечно и не читает неограниченный body.
- Retry происходит только для классифицированной безопасной операции; writes имеют receipt/idempotency key либо не ретраятся.
- Maintenance продолжает с checkpoint и не повторяет уже подтверждённые destructive actions.
- Partial failure виден по job/item class и восстанавливается runbook-ом.

## Проверка и ловушки

```sh
bun test backend/tests/telegram.test.ts backend/tests/storage.test.ts backend/tests/worker.test.ts
bun run typecheck
bun run build
```

Не запускать unbounded `Promise.all`; не путать Worker wall time и network timeout. Backup/restore надёжность вынесена в TD-203, здесь только безопасное выполнение текущих jobs.

## Вероятные файлы

`backend/src/lib/telegram.ts`, Storage client/helpers, maintenance/backup/privacy modules, `worker.ts`, tests.
