# Этап 2, задача 2: безопасный dependency-free нагрузочный runner

## Цель

Добавить явный операторский Bun-runner для HTTP-нагрузки на готовый API. Runner должен воспроизводить read journey `auth → profile → catalog`, поддерживать строго opt-in concurrent requests/feedback, oversized probe и rate-limit probe, собирать метрики без утечки секретов и не запускаться автоматически. Финальный production run не выполнять: он допускается только после M1 на staging/canary с Supabase/Cloudflare Observability.

## Контекст

- Использовать существующий `signInitData` из `e2e/helpers/telegramAuth.ts`; HMAC Telegram не дублировать.
- `POST /auth/telegram` принимает `{ initData }` и возвращает `{ token, profile }`.
- Read journey: `GET /profile`; `GET /catalog/categories?type=product|service`; `GET /catalog/cards?type=product|service&limit=1&offset=0`; при наличии первой карточки — `GET /catalog/cards/:id`.
- Auth upsert уже создаёт/обновляет тестовых пользователей. Термин read-only ниже означает отсутствие заявок/feedback/регистрации, а не отсутствие DB writes вообще.
- Mutation mode создаёт durable данные и потенциальные Telegram notifications; поэтому он запрещён по умолчанию и имеет отдельные guards.
- Текущий этап 1 уже изменяет `backend/README.md`, `SECURITY_IMPLEMENTATION_PLAN.md` и другие файлы. Сохранить эти пользовательские изменения; менять в документах только относящиеся к M5 участки.

## Файлы

- Создать: `e2e/scripts/loadTest.ts`
- Создать: `e2e/scripts/loadTest.test.ts`
- Изменить: `package.json`
- Изменить: `backend/README.md`
- Изменить: `SECURITY_IMPLEMENTATION_PLAN.md` только в разделе этапа 2/M5

## Обязательные ограничения

- Работать в текущем workspace, без ветки, commit, staging или git cleanup.
- Использовать `apply_patch` для правок.
- Следовать TDD: pure-function tests → наблюдаемый RED → минимальная реализация → GREEN.
- Не добавлять dependencies и не менять lockfile.
- Не читать и не печатать реальные `.env`, `DATABASE_URL`, bot token, JWT, request/response bodies или персональные данные.
- Не запускать сам load test и не отправлять HTTP-запросы к внешним целям.
- Не менять API routes, contracts, DB queries, migrations, Cloudflare bindings или код этапа 1.
- Не маскировать невыполненный production gate: M1, порт `6543`, тарифные limits, Supabase connections, Worker `5xx`, DB `53300` и p95/p99 проверяются операционно позже.

## Публичные pure interfaces для тестирования

Экспортировать из `e2e/scripts/loadTest.ts` типы и функции с ясными строгими типами, без `any`:

- `parseLoadConfig(env)` — валидирует config и возвращает нормализованный exact API origin, counts/duration, flags и run id.
- `buildUser(index, runId)` — детерминированный уникальный positive safe-integer Telegram id в выделенном test range и test-only имя.
- `buildReadJourney(token, type)` — exact requests для profile/categories/cards; card detail строится после разбора list response.
- `buildRequestPayload(runId, userIndex)` — UUID idempotency key, `source: "profile"`, marker `[load-test]`, reserved test phone.
- `buildFeedbackPayload(runId, userIndex)` — marker и reserved test contact.
- `makeOversizedJson(limitBytes)` — valid JSON с UTF-8 размером ровно `limitBytes + 1`.
- `classifyResponse(status, expectedKind)` — различает normal success, expected 413, expected 429, client error и server error.
- `summarize(samples)` — totals и per-route p50/p95/p99, counts 413/429/4xx/5xx/pool signals; не хранит raw body или secrets.

Названия вспомогательных внутренних функций могут отличаться. Экспортируемые функции должны оставаться side-effect free; CLI запускается только когда файл является entry point.

## Конфигурация и safety guards

Всегда обязательны:

- `LOAD_TEST_API_URL`: абсолютный `http:`/`https:` URL без credentials, query/hash и без path кроме `/`; normalise до `origin`.
- `LOAD_TEST_ALLOW_TARGET`: должен точно совпасть с нормализованным origin. Это явное подтверждение даже для default journey, потому что auth делает DB upsert.
- `LOAD_TEST_TELEGRAM_BOT_TOKEN`, с допустимым fallback на существующий `TELEGRAM_BOT_TOKEN`; значение никогда не логировать.
- `LOAD_TEST_USERS`, `LOAD_TEST_CONCURRENCY`, `LOAD_TEST_DURATION_SECONDS`: положительные safe integers; concurrency не больше users. Ввести документированные разумные upper bounds, предотвращающие случайный неограниченный запуск.

Опционально:

- `LOAD_TEST_ENABLE_MUTATIONS=1`: включает один concurrent request и один feedback flow на виртуального пользователя, а не бесконечные durable writes.
- При mutations дополнительно обязательны `LOAD_TEST_ALLOW_WRITE_TARGET === origin` и `LOAD_TEST_NOTIFICATIONS_DISABLED_CONFIRMED=1`.
- `LOAD_TEST_RATE_LIMIT_PROBE=1`: после основной нагрузки отдельным test user делает ограниченное число authenticated read запросов до первого `429`; проверяет наличие положительного integer `Retry-After` и совпадающего `retryAfterSeconds`. Максимум запросов должен быть ограничен и документирован.
- Oversized probe безопасно выполняется один раз на каждый run и ожидает `413` до DB.

Default mode не вызывает `/profile/register`, `/requests` или `/feedback`.

## HTTP execution

1. Создать пул виртуальных тестовых Telegram users, каждый аутентифицировать через подписанный актуальный initData.
2. Ограничить одновременную работу значением concurrency; каждый user проходит profile/categories/cards и, если есть карточка, detail. Пустой каталог записывать как `skipped_no_cards`, не как ошибку.
3. До deadline повторять read journey без создания новых пользователей или повторной auth на каждый request.
4. При mutation opt-in один раз на user:
   - отправить `/requests` с test marker;
   - зарегистрировать test profile;
   - отправить `/feedback` с test marker.
5. Oversized probe отправляет valid oversized JSON на API route и требует `413`.
6. Rate probe выполняется только при opt-in; отсутствие ожидаемого `429` в пределах лимита считается непрошедшим probe, но документация отмечает location-local/eventual consistency Cloudflare.
7. На stdout выводится только агрегированный JSON/text summary: route, counts, p50/p95/p99, 413/429/4xx/5xx, pool-error signals, skipped cards и run metadata без токенов/URL credentials/body.
8. Process exit code non-zero при unexpected 4xx, любом 5xx, pool exhaustion/`53300` signal, провале oversized probe или включённого rate probe. Transport errors также считаются failure.

## Package script

Добавить только операторскую команду:

```json
"load:test": "bun --env-file=.env e2e/scripts/loadTest.ts"
```

Не включать её в `test`, `test:e2e`, build или CI.

## Документация

В `backend/README.md` кратко зафиксировать:

- параметры app-side pool на один Worker isolate: `max=3`, `idle_timeout=20`, `connect_timeout=10`, `prepare=false`; `max_lifetime` остаётся default;
- transaction pooler `6543` и несовместимость session-bound prepared statements;
- точную команду runner и env guards без значений секретов;
- mutations создают durable test data и разрешены только на dedicated staging/dev с отключёнными notifications и внешним reset/cleanup;
- после M1 выбрать нагрузку минимум `2×` ожидаемого launch peak и одновременно наблюдать Supabase client/backend connections, `53300`/pool exhaustion, Worker `5xx`, p95/p99;
- runner не доказывает production capacity без Observability.

В `SECURITY_IMPLEMENTATION_PLAN.md` в M5 добавить статус: repository-часть (explicit config + runner) реализована; production `DATABASE_URL`/limits/metrics и acceptance load остаются deployment gate после M1. Не помечать весь этап завершённым.

## TDD и проверки

1. Сначала создать `e2e/scripts/loadTest.test.ts` для config guards, unique test users, exact routes/headers, mutation payload markers, exact UTF-8 oversized length, response classification, percentiles/summary и отсутствия raw bodies.
2. Запустить `cmd.exe /d /c bun test e2e/scripts/loadTest.test.ts`; получить RED из-за отсутствующего module/functions.
3. Реализовать минимальный runner.
4. Повторить focused test до GREEN с чистым output.
5. Запустить `cmd.exe /d /c bun run typecheck`.
6. Не запускать `load:test`.

## Отчёт

Записать через `apply_patch` полный отчёт в `.superpowers/sdd/stage2-task2-report.md`: RED/GREEN evidence, typecheck, изменённые файлы, self-review, точное описание невыполненного live gate. В финальном сообщении вернуть только статус, одну строку проверок, concerns и путь отчёта. Коммиты не создавать.
