# Этап 2, задача 2 — отчёт

## Результат

Добавлен dependency-free Bun runner для явного ручного HTTP load test. Он использует существующий `signInitData`, не запускается при импорте, требует точного opt-in target, ограничивает пользователей/concurrency/duration, выполняет read journey `auth → profile → catalog`, один oversized probe и опциональный bounded rate-limit probe. Durable mutations выключены по умолчанию и защищены отдельными write-target/notifications guards.

`load:test` не запускался. Внешние HTTP-запросы не выполнялись. Реальные `.env`, bot token, JWT, `DATABASE_URL`, request/response bodies и персональные данные не читались и не печатались в ходе реализации.

## TDD evidence

### RED

Команда:

```text
cmd.exe /d /c bun test e2e/scripts/loadTest.test.ts
```

Результат: exit code `1`; ожидаемая причина — модуль реализации ещё отсутствовал.

```text
error: Cannot find module './loadTest' from '...\e2e\scripts\loadTest.test.ts'
0 pass
1 fail
1 error
```

### GREEN

После минимальной реализации та же команда завершилась с exit code `0`:

```text
15 pass
0 fail
61 expect() calls
```

Покрыты config/target/mutation guards, upper bounds, fallback bot token, deterministic test users, точные read routes и Bearer headers, card-detail parsing, mutation markers/reserved phone/UUID idempotency key, точный UTF-8 размер oversized JSON, response classification, per-route p50/p95/p99 и удаление raw body/token из summary.

## Проверки

- `cmd.exe /d /c bun test e2e/scripts/loadTest.test.ts` — exit `0`, `15 pass`, `0 fail`.
- `cmd.exe /d /c bun run typecheck` — exit `0`; contracts build, backend TypeScript и webapp TypeScript завершились без ошибок.
- `git diff --check -- package.json backend/README.md SECURITY_IMPLEMENTATION_PLAN.md` — exit `0`; только существующие предупреждения Git о будущем LF→CRLF преобразовании.
- Дополнительная попытка isolated `tsc` для e2e-файлов не стартовала: локальный Windows shim `node_modules\.bin\tsc.cmd` отсутствует. Это не required gate; новые файлы импортированы и исполнены Bun focused test, но отдельного compile-only e2e tsconfig в репозитории нет.

## Изменённые файлы

- `e2e/scripts/loadTest.test.ts` — pure-function regression tests.
- `e2e/scripts/loadTest.ts` — pure interfaces и guarded CLI runner.
- `package.json` — только ручной script `load:test`.
- `backend/README.md` — только pool/load runner, guards, limits и live acceptance gate.
- `SECURITY_IMPLEMENTATION_PLAN.md` — только статус M5.
- `.superpowers/sdd/stage2-task2-report.md` — этот отчёт.

Lockfile, API routes, contracts, DB queries, migrations, Cloudflare bindings и код этапа 1 не менялись. Существующие пользовательские изменения, включая `backend/src/db.ts`, `backend/tests/db.test.ts` и M2/M3 sections, сохранены.

## Self-review

- Exported test interfaces не выполняют HTTP и не читают environment; CLI защищён `import.meta.main`.
- `LOAD_TEST_API_URL` допускает только credential-free `http(s)` origin без path/query/hash; allow target сравнивается с нормализованным origin точно.
- CLI читает только перечисленные load/auth env keys и никогда не выводит token/initData/JWT/body; summary строится заново из агрегированных полей.
- Default mode не вызывает `/profile/register`, `/requests` или `/feedback`; обязательный auth upsert явно отражён в target guard и документации.
- Mutation mode выполняет по одному request/register/feedback flow на пользователя, ограничен общей concurrency и требует точного write target плюс подтверждение отключённых notifications.
- Каждый authenticated user проходит хотя бы один read journey; дальнейшие journeys повторяются до deadline без создания новых пользователей и повторной auth на каждый request.
- Empty catalog учитывается как `skipped_no_cards`; transport/protocol errors, неожиданные 4xx, любые 5xx, pool/`53300`, failed 413 и enabled failed 429 probe приводят к non-zero exit.
- Rate probe ограничен 200 requests, использует отдельного test user и проверяет положительный integer `Retry-After` против JSON `retryAfterSeconds`.
- Redirect follow отключён, каждый request ограничен 30 секундами, а operator limits составляют 2 000 users, concurrency 200 и duration 1 800 секунд.

## Невыполненный live gate

Repository-часть M5 реализована, но production capacity не подтверждена. После M1 требуется отдельный staging/canary run не менее `2×` ожидаемого launch peak с Supabase/Cloudflare Observability. До acceptance необходимо без вывода секрета подтвердить transaction pooler и порт `6543`, фактические тарифные client/backend connection limits и baseline connection metrics. Во время run необходимо одновременно наблюдать Supabase client/backend connections, `53300`/pool exhaustion, Worker `5xx`, p95/p99 и limiter behavior с учётом location-local/eventually consistent Cloudflare counters. Mutation mode допустим только при фактически отключённых notifications и внешнем reset/cleanup. До выполнения этого gate production `DATABASE_URL`, limits, metrics и capacity остаются непроверенными; runner сам по себе capacity не доказывает.

## Готовое сообщение коммита

`feat(e2e): add guarded load test runner`

## Review fixes: bounded rate probe и redirects

### Finding 1 — bounded rate-limit burst

Root cause: прежний probe выполнял до 200 requests строго последовательно с общим request timeout 30 секунд. Worst-case составлял 6 000 секунд, а при достаточной latency частота могла не пересечь limiter threshold `120/60`.

RED:

```text
cmd.exe /d /c bun test e2e/scripts/loadTest.test.ts
exit 1
15 pass, 2 fail
Expected runBoundedProbeBatches: function; received undefined
```

GREEN после минимальной реализации:

```text
17 pass
0 fail
74 expect() calls
```

Исправление: read burst имеет абсолютный deadline 45 000 ms, максимум 200 requests, fixed concurrency/batch size 10. Планируется только один batch за раз. После первого `429` следующий batch не создаётся; `Promise.allSettled` дожидается всех уже in-flight операций. Каждый read request получает оставшееся время абсолютного deadline, поэтому зависший batch не выходит за 45-секундное limiter window. Первый observed `429` по-прежнему проходит проверки positive integer `Retry-After` и matching JSON `retryAfterSeconds`.

### Finding 2 — отдельный redirect outcome

Root cause: fallback `classifyResponse` относил `3xx` к `client_error`, а summary увеличивал `clientErrors4xx`, хотя status не принадлежал диапазону 4xx.

RED:

```text
cmd.exe /d /c bun test e2e/scripts/loadTest.test.ts
exit 1
17 pass, 1 fail
Expected: redirect_error
Received: client_error
```

GREEN после минимальной реализации:

```text
18 pass
0 fail
79 expect() calls
```

Исправление: `3xx` получает outcome `redirect_error` и отдельный aggregate count `redirectErrors`; `clientErrors4xx` остаётся нулевым для redirect. `hasRunFailure` считает любой redirect non-zero failure. Fetch по-прежнему использует `redirect: "manual"`, поэтому runner не следует на новый target.

### Финальная проверка review fixes

- `cmd.exe /d /c bun test e2e/scripts/loadTest.test.ts` — exit `0`, `18 pass`, `0 fail`, `79 expect() calls`.
- `cmd.exe /d /c bun run typecheck` — exit `0`; contracts, backend и webapp TypeScript завершились без ошибок.
- `load:test` не запускался; сетевые запросы не выполнялись.
- Изменены только `e2e/scripts/loadTest.ts`, `e2e/scripts/loadTest.test.ts`, точный rate-probe bounds paragraph в `backend/README.md` и этот append отчёта.
