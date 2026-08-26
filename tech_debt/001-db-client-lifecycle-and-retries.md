# TD-001 — Безопасное владение DB-клиентом и явные ретраи

**Приоритет:** P0  
**Этап:** 1  
**Оценка:** M  
**Зависимости:** нет; должна предшествовать широкому repository-рефакторингу.
**Статус:** ✅ Выполнено (2026-08-26; финальный code review: 10/10)

## Фактическое выполнение

- DB capability теперь создаётся внутри HTTP request, queue batch или scheduled invocation; module-global client/reconnect state удалён.
- Обычные standalone-запросы и transaction callback не повторяются после transport failure. Единственный повтор доступен через явно названный `retryIdempotentStandalone`; поздний отказ устаревшего client не создаёт лишний replacement.
- Локальный Bun lifecycle дожидается зарегистрированных `runInBackground` задач и закрывает принадлежащие invocation clients; Worker оставляет cleanup Hyperdrive/платформе.
- Добавлены lifecycle, retry, transaction и concurrent-failure regression tests; repository/routes/queue/scheduled consumers переведены на явную DB capability.
- Проверено: полный unit/contract набор — 249 pass, 17 integration tests skipped без `TEST_DATABASE_URL`, 0 fail; `bun run typecheck` — успешно; `bun run build` — успешно, с уже известным `EPERM` Wrangler при записи локального log-файла.
- Live Worker/Hyperdrive smoke и origin connection count в эту локальную реализацию не входят и остаются отдельной эксплуатационной проверкой перед rollout.

## Проблема и доказательства

`backend/src/db.ts:7-8, 140-150` держит `postgres.js` client/pool и single-flight reconnect в module scope. На один Worker isolate pool разрешает до трёх соединений (`:10-15`). Значительная часть файла (`:61-131`) существует, чтобы ремонтировать сокет, переживший предыдущий request.

Текущая официальная модель Hyperdrive — новый client на request, а underlying pooling принадлежит Hyperdrive. Module-global ownership повышает суммарное число логических соединений при масштабировании isolates и создаёт stale-socket механику, которую приложение вынуждено угадывать.

Вторая проблема важнее размера pool: proxy `withReconnect()` прозрачно повторяет любой standalone tagged-template query после сетевой ошибки (`:99-117`). Комментарий утверждает, что такие запросы идемпотентны, но это не enforceable invariant. Например создание сессии — обычный INSERT (`backend/src/repos/sessions.ts:30-38`), audit event — INSERT (`backend/src/repos/adminAudit.ts:15-27`). Потеря ACK после commit неотличима от неисполненного запроса; общий retry может дать конфликт, дубль или ложный 500.

## Цель

- DB client имеет очевидного владельца и не переносит request-scoped I/O между запросами.
- Транзакции и write-запросы не повторяются скрыто.
- Retry разрешён только там, где вызывающий слой доказал read-only/idempotent семантику.
- Локальный Bun runtime и Worker/Hyperdrive используют один понятный API без generic repository.

## Не входит

- Смена PostgreSQL driver.
- Собственный connection pool поверх Hyperdrive.
- Автоматический retry транзакции после ambiguous commit.
- Изменение production Hyperdrive без отдельной операции и smoke-test.

## TDD-план

1. **Red — зафиксировать семантику.** Расширить `backend/tests/db.test.ts`:
   - write/query с ошибкой после возможной отправки не повторяется автоматически;
   - явно помеченная read/idempotent операция допускает максимум один reconnect retry;
   - transaction callback никогда не выполняется второй раз;
   - два request scope не разделяют один client instance;
   - после handler/job нет незавершённого DB I/O или promise, переживающего invocation.
2. Добавить небольшой invocation-scoped DB provider/capability. Создавать client из `HYPERDRIVE.connectionString` или локального `DATABASE_URL` внутри request/queue/scheduled invocation. Не передавать full `AppEnv` глубже необходимого. Не требовать ручной `end()` в Worker: Cloudflare cleanup выполняется после invocation; вызывать его только там, где конкретный local runtime/driver test доказывает необходимость.
3. Удалить module-global `client/reconnecting` и Proxy, когда новые tests докажут эквивалентное поведение чтений и безопасное поведение writes.
4. Для реально нужных retries сделать явный helper с названием, отражающим гарантию, либо оставить reconnect на следующем запросе. Не классифицировать constraint/business errors как connection errors.
5. Прогнать интеграционную матрицу: обычный read, standalone write, transaction, потеря соединения до запроса, потеря соединения на transaction boundary.
6. Выполнить isolated load/smoke и проверить число origin connections/ошибок до production rollout.

## Критерии приёмки

- В `backend/src/db.ts` нет mutable module-global DB client или reconnect promise.
- Ни один write не ретраится без явной idempotency-гарантии на call site.
- Transaction callback вызывается ровно один раз при любом connection failure.
- Все route/queue/scheduled paths создают client внутри invocation, не разделяют его между invocation и полностью await-ят DB I/O.
- Существующие request/card idempotency receipts продолжают восстанавливать ambiguous commit на доменном уровне.
- Есть тест, который падает на старой прозрачной retry-механике и зелёный на новой.

## Проверка

```sh
bun test backend/tests/db.test.ts backend/tests/requestIdempotency.test.ts
bun run typecheck
bun run test:integration
bun run build
```

Дополнительно: Worker/Hyperdrive smoke с контролем connection errors и origin connection count. Production credentials/config не менять в рамках unit-рефакторинга.

## Ловушки и rollback

- Нельзя выносить DB promise/client в module scope или завершать invocation до await/`waitUntil` его I/O.
- Нельзя маскировать ambiguous write новым generic retry wrapper.
- Слишком большой `max` на request client умножится на concurrency; начать с минимального значения и измерить.
- Rollback — вернуть предыдущий deploy, не менять schema. Если новый lifecycle ухудшает connections, остановить rollout и сохранить доменные idempotency changes.

## Вероятные файлы

`backend/src/db.ts`, `backend/src/app.ts`, `backend/src/worker.ts`, узкие repository capability types, `backend/tests/db.test.ts`, integration harness, `backend/README.md`.
