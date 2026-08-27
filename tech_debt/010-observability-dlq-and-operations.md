# TD-010 — Наблюдаемость, DLQ и operational closure

**Приоритет:** P1, с обязательным P0/S milestone перед следующим production canary  
**Этап:** 1  
**Оценка:** M  
**Зависимости:** TD-003A определяет handler contracts; TD-003B обязателен перед redrive outbox-сообщений.
**Статус:** выполнено 27.08.2026

## Проблема

Система пишет outcomes/request-id, но почти не измеряет duration по нормализованным routes, DB/Storage/Telegram latency и queue age. Email alerts и analytics token по `DEPLOYMENT.md` не активированы; alert job без token становится no-op. DLQ созданы, но consumer/replay/drain и ownership не закрыты. Поэтому документированные canary thresholds требуют ручного наблюдения и могут остаться silent.

## План

1. **P0/S release-readiness:** включённый test alert, подтверждённый owner каждой DLQ, metrics query и bounded inspect probe. Следующий canary запрещён, если этот preflight silent/красный.
2. **P1 observability:** определить минимальные SLI: HTTP count/error/duration по route template, DB/Telegram/Storage duration+outcome, queue attempts/age, cron duration/items, DLQ depth. Запретить user/card IDs как metric labels.
3. Добавить timer helper вокруг существующих boundaries, не новую telemetry abstraction/platform. Проверить sampling/cost.
4. После TD-003B описать triage/redrive с доказанной outbox idempotency и poison-message quarantine; сначала ручной безопасный command с dry-run, затем automation только при повторяемой нагрузке.
5. Разделить runtime fail-open (например, analytics недоступна) и release fail-closed. Executable handler contract принадлежит TD-003A, timeout/retry/deadline mechanics — TD-011.

## Критерии приёмки

- По request-id/trace видно route → DB/external call → queue/cron outcome без PII.
- Canary нельзя начать при silent monitoring.
- У каждой DLQ есть alert, owner, runbook, bounded inspect/redrive и доказанная idempotency.
- Метрики имеют bounded cardinality и понятный retention/cost.

## Проверка и ловушки

Unit tests redaction/route normalization; local injected timing tests; production read-only preflight и test alert — только с явной operational авторизацией. Не логировать bodies, initData, phones, tokens. Не строить dashboard zoo: одна операторская панель и один release checklist достаточны.

## Статус (26.08.2026)

- Реализованы bounded Analytics Engine dimensions: HTTP route template + status/duration, DB,
  Telegram, Storage, Queue attempt/age и cron outcome/duration. Raw path и identifiers в labels
  не попадают; `unmatched` — единый label для 404.
- Authorized production read-only preflight: primary queues имеют по одному producer/consumer;
  `agromarketkz-notifications-dlq-prod` и `agromarketkz-telegram-updates-dlq-prod` имеют 0
  consumers, что соответствует quarantine policy. Owner обеих DLQ — production
  `ADMIN_OWNER_TELEGRAM_ID`; redrive только вручную после inspect и проверки TD-003B idempotency.
- P0/S закрыт 27.08.2026: live Worker содержит отдельный read-only
  `CF_ANALYTICS_API_TOKEN`, owner подтвердил test notification и четыре Workers Observability
  alerts (5xx, DB connection, primary backlog, DLQ). `DEPLOYMENT.md` остаётся executable
  fail-closed runbook для всех последующих canary.

## Вероятные файлы

`backend/src/app.ts`, external clients, `worker.ts`, `alerts.ts`, release scripts, `DEPLOYMENT.md`.
