# backend

REST API на **Hono**, работает на двух рантаймах из одного кода: локально на **Bun** (`src/index.ts`) и на **Cloudflare Workers** (`src/worker.ts`). База — **PostgreSQL** через [postgres.js](https://github.com/porsager/postgres). Валидация запросов/ответов — Zod-схемы из `@agromarket/contracts`.

## Запуск

```sh
bun run dev          # Bun, watch, http://localhost:3000
bun run dev:worker   # эмуляция Cloudflare Workers (wrangler dev)
bun run typecheck
bun test
```

Переменные окружения локально читаются из корневого `.env` (`Bun.env`), на Workers — из `c.env` (см. `wrangler.toml` и `wrangler secret put`). Для production требуются `PAGES_PROXY_SECRET`, `ADMIN_OWNER_TELEGRAM_ID`, `TELEGRAM_BOT_TOKEN`, `ADMIN_ALLOWLIST`, `WEBAPP_ORIGIN` и Hyperdrive; прямой `DATABASE_URL` не является production fallback. `DATABASE_URL` и origin credentials Hyperdrive должны принадлежать отдельной runtime-роли без superuser/DDL-привилегий; миграции используют отдельный `MIGRATION_DATABASE_URL`.

CORS разрешает только точный `WEBAPP_ORIGIN` (сравнение origin запроса, без wildcard и без localhost-fallback в коде): production-значение в `wrangler.toml` — `https://agromarketkz-webapp.pages.dev` (домен детерминирован именем Cloudflare Pages проекта). Локально `wrangler dev` переопределяет его через `backend/.dev.vars` (не в git), обычный `bun run dev` — через корневой `.env`.

## Структура

```
src/
  app.ts            # фабрика createApp(): middleware окружения, CORS, onError, монтаж роутов
  index.ts          # точка входа Bun (Bun.serve)
  worker.ts         # точка входа Cloudflare Workers
  env.ts            # тип AppEnv, слияние Bun.env + c.env, getEnv(c)
  db.ts             # ленивый синглтон postgres.js
  repos/            # SQL-доступ к пользователям, каталогу, заявкам, настройкам и Storage
  lib/
    telegram.ts     # валидация initData и Login Widget (Web Crypto, HMAC-SHA256)
    jwt.ts          # выпуск/проверка JWT (hono/jwt, HS256, 24 часа, версия сессии)
    admin.ts        # валидация и кеш ADMIN_ALLOWLIST, проверка прав по числовому id
    telegramId.ts   # общий допустимый диапазон реальных и синтетических Telegram id
    errors.ts       # HttpError (статус + сообщение)
    storage*.ts     # signed URL, cleanup и versioned R2 backup snapshots
    notificationOutbox.ts # durable at-least-once Telegram delivery через Queue/DLQ; stale lease recovery
    adminAuditOutbox.ts   # scheduled recovery, bounded retries и operator-visible dead letters
    telegram*.ts    # webhook, requestContact и уведомления в Telegram
  middleware/
    auth.ts         # requireAuth — проверка Bearer JWT
    admin.ts        # requireAdmin — живая проверка прав
  routes/
    auth.ts         # /auth/telegram, /auth/widget/exchange (legacy /auth/widget alias)
    catalog.ts      # /catalog/categories и /catalog/cards
    profile.ts      # профиль, регистрация и проверка Telegram-контакта
    admin/          # управление каталогом, заявками, пользователями, настройками и загрузками
tests/              # unit- и контрактные тесты
```

## Модель авторизации (Этап 3)

Личность подтверждается Telegram, отдельного логина/пароля нет. Две ветки входа:

- **Telegram Mini App** — клиент шлёт сырой `initData`; backend пересчитывает HMAC-подпись `TELEGRAM_BOT_TOKEN` (секрет `HMAC_SHA256("WebAppData", token)`), сверяет `hash` и свежесть `auth_date` (окно 24 ч).
- **Браузер (Telegram Login Widget)** — backend проверяет подпись с секретом `SHA256(token)`, принимает
  `auth_date` не старше 5 минут и атомарно записывает HMAC proof в `app_private.widget_auth_proofs`,
  поэтому один redirect нельзя обменять дважды.

После успешной валидации создаётся/обновляется `User` (зеркало Telegram: id, username, имя — обновляется при каждом входе; контактные имя/телефон неприкосновенны) и выдаётся **JWT на 24 часа** (`Authorization: Bearer`). В Telegram токен молча перевыпускается из свежего `initData`, поэтому повторного входа пользователь не видит.

**Админы** определяются по `ADMIN_ALLOWLIST` (числовые Telegram id, через запятую). Принимаются
только канонические положительные целые без ведущих нулей, не выше `2^52`; битые токены
отбраковываются с предупреждением. Список мемоизируется по исходной строке секрета, поэтому
повторные проверки не парсят и не логируют его заново, а смена значения применяется на первом
следующем запросе. Проверка остаётся живой (`requireAdmin`), статус в токен не зашит.

## JWT-сессии и отзыв

JWT выпускается на 24 часа с claims `sub`, `tgId`, `ver`, `iat` и `exp`. `requireAuth` проверяет подпись и форму claims, затем одним запросом к `users` сверяет существование пользователя, его `telegram_id` и `token_version`. Production устанавливает `AUTH_CACHE_MODE=disabled`, поэтому отзыв сессии не ждёт KV TTL; `read-through` допускается только как осознанная capacity-настройка. Удалённый пользователь или несовпадение версии получают `401`; сбой БД остаётся серверной ошибкой.

Миграция `0006_user_token_version.sql` добавляет `users.token_version`. Администратор отзывает все ранее выданные JWT пользователя запросом `POST /admin/users/:id/revoke-sessions`; маршрут возвращает `204`, либо `404` для отсутствующего UUID-пользователя. Новый вход выдаёт JWT с новой версией. Legacy JWT без `ver` и `iat` временно считается версией `0` до собственного `exp`.

## API

Все маршруты, кроме health, входа и Telegram-вебхука, требуют `Authorization: Bearer <JWT>`. Контракты запросов и ответов находятся в `packages/contracts`.

| Группа | Маршруты |
|-------|----------|
| Сервис и вход | `GET /health`, `POST /auth/telegram`, `POST /auth/widget/exchange` (`/auth/widget` — временный alias) |
| Профиль | `GET /profile`, `POST /profile/register`, `PUT /profile`, `POST /profile/contact` |
| Каталог | `GET /catalog/categories`, `GET /catalog/cards`, `GET /catalog/cards/:id` |
| Контакты площадки | `GET /settings/capabilities`, `GET /settings` |
| Пользовательские действия | `GET/POST /favorites`, `DELETE /favorites/:cardId`, `POST /requests`, `POST /feedback` |
| Telegram | `POST /telegram/webhook` с заголовком `X-Telegram-Bot-Api-Secret-Token` |
| Администрирование | категории, карточки, загрузки, заявки, пользователи и настройки под `/admin/*` |

`/catalog/*` доступен сразу после подтверждения Telegram-личности. Реальные контакты из `GET /settings`, избранное, обратная связь и личные разделы требуют заполненного профиля. `POST /requests` принимает первую заявку вместе с контактами и атомарно завершает регистрацию. Заявки и feedback в той же транзакции записывают `app_private.notification_outbox`; Worker Queue доставляет Telegram at-least-once, восстанавливает stale `processing` rows и подтверждает Queue-сообщение только после fenced terminal state. Повтор с тем же `clientRequestId` не создаёт второе событие. В уведомление добавляется `outboxId` для дедупликации.

Админские изменения записывают PII-free audit intent в `app_private.admin_audit_outbox` внутри той же
транзакции, что и бизнес-изменение. Финальная запись в append-only `admin_audit_events` выполняется
после commit и восстанавливается пятиминутным cron; после 20 неудач intent становится `dead_letter`
и требует явного операторского requeue.

`contactPhone` принимается только как казахстанский мобильный (`+7 7xx`), нормализуется к `+77XXXXXXXXX`; иначе `400`. Ошибки используют единый JSON `{ error, issues? }` со статусами `400/401/403/404/409/413/429/500`.

## Ограничение запросов и rate limiting

После CORS и до маршрутов все request bodies API ограничены 256 KiB. Переполнение возвращает `413` с JSON `{"error":"Размер запроса превышает 256 KiB"}`. Загрузка файлов по signed URL выполняется клиентом напрямую в Supabase Storage и через backend body не проходит.

В production Worker использует нативные Cloudflare Rate Limiting bindings:

- `API_READ_RATE_LIMITER`: 120 запросов за 60 секунд, ключ — `userId`;
- `API_MUTATION_RATE_LIMITER`: 30 запросов за 60 секунд, ключ — `userId:routeGroup`;
- `AUTH_RATE_LIMITER`: широкий потолок 300 запросов за 60 секунд, ключ — `CF-Connecting-IP`;
- `AUTH_IDENTITY_RATE_LIMITER`: 10 запросов за 60 секунд, ключ — `IP:telegramId`.

Оба auth-limiter применяются на `/auth/telegram`, `/auth/widget/exchange` и временном alias
`/auth/widget` до проверки Telegram-подписи.
Telegram id извлекается из неподписанного тела только для ключа и не участвует в авторизации.
Составной ключ не позволяет постороннему IP заблокировать известный id, а IP-потолок ограничивает
перебор поддельных id. Если id безопасно извлечь нельзя, identity-limiter пропускается; битый JSON
доходит до Zod и возвращает `400`.

Локальный запуск без bindings работает в режиме no-op. Отказ limiter возвращает `429`, заголовок `Retry-After: 60` и JSON-поле `retryAfterSeconds: 60`. Счётчики Cloudflare являются location-local и eventually consistent, поэтому не используются как точный бизнес-счётчик; существующие бизнес-лимиты хранятся отдельно.

Live probe после первого deployment двухуровневой схемы подтвердил permissive-семантику:
при конфигурации identity 10/мин первый `429` появился на 34-м запросе для двух свежих ключей.
Binding ограничивает устойчивый поток, но не гарантирует точный отказ на 11-м запросе; если
нужна строгая граница, потребуется другой stateful-механизм.

Перед deployment проверить namespace `2026072001`, `2026072002`, `2026072601` и
`2026072602` на уникальность в пределах Cloudflare account. Новые namespace для auth-limiter
намеренно обнуляют старые счётчики при ослаблении IP-порога. Счётчики и долю `429` нужно
наблюдать в первые сутки запуска; `OPTIONS` и `/telegram/webhook` не входят в auth-limiter.

## Пул БД и нагрузочный runner

`createDatabaseInvocation` (`backend/src/db.ts`) владеет одним логическим `postgres.js` client на один HTTP request, queue batch или scheduled invocation; его mutable state не выходит из invocation scope, а `max: 1`, `idle_timeout: 20`, `connect_timeout: 10`, `prepare: false` не создают дополнительный application-level pool. `max_lifetime` остаётся библиотечным default. Production подключается через биндинг `HYPERDRIVE` (`createClient`), настроенный на Supavisor **session-mode** через порт `5432`, с `--caching-disabled` — Hyperdrive по умолчанию кеширует чтения на 60с без инвалидации при записи, что ломает свежесть auth-кеша и профиля сразу после записи. `DATABASE_URL`-секрет остаётся: он используется на локальном Bun (там `HYPERDRIVE` отсутствует) и как ручной fallback при инциденте с самим Hyperdrive — там, где он используется напрямую (локально), это по-прежнему Supavisor transaction-mode (`6543`), поэтому `prepare: false` не убираем ни при каком пути подключения.

После транспортной ошибки обычный запрос получает новый client для следующего вызова, но сам ошибочный запрос не повторяется: это сохраняет корректность ambiguous writes. Единственный retry — явно вызванный `retryIdempotentStandalone` для доказуемо read-only/idempotent standalone statement; transaction callback всегда выполняется ровно один раз. Локальный Bun runtime ждёт зарегистрированные `runInBackground` задачи и вызывает `dispose()` после request, а Worker оставляет закрытие client платформе/Hyperdrive и не вызывает `end()` вручную.

Runner запускается только вручную командой `bun run load:test`. Обязательные env guards: `LOAD_TEST_API_URL`, точное подтверждение origin в `LOAD_TEST_ALLOW_TARGET`, `LOAD_TEST_TELEGRAM_BOT_TOKEN` (или fallback `TELEGRAM_BOT_TOKEN`), `LOAD_TEST_USERS`, `LOAD_TEST_CONCURRENCY`, `LOAD_TEST_DURATION_SECONDS`. Значения ограничены сверху: 2 000 пользователей, concurrency 200 и 1 800 секунд. Даже default journey требует `LOAD_TEST_ALLOW_TARGET`, поскольку `/auth/telegram` выполняет DB upsert. Oversized probe выполняется один раз и требует `413`.

`LOAD_TEST_RATE_LIMIT_PROBE=1` включает отдельного пользователя. После отдельной auth с request timeout 30 секунд runner выполняет read burst с абсолютным deadline 45 секунд — короче 60-секундного limiter window — и максимумом 200 запросов. Запросы планируются batches по 10 с фиксированной concurrency 10; после первого `429` новые batches не планируются, а все уже in-flight responses полностью consumed/settled. Runner проверяет положительный `Retry-After` и совпадающий `retryAfterSeconds`. Из-за location-local/eventually consistent счётчиков Cloudflare отсутствие `429` в пределах deadline/лимита считается провалом probe и оценивается в контексте конкретной location.

Default mode не вызывает `/profile/register`, `/requests` и `/feedback`. `LOAD_TEST_ENABLE_MUTATIONS=1` дополнительно требует `LOAD_TEST_ALLOW_WRITE_TARGET`, точно равный origin, и `LOAD_TEST_NOTIFICATIONS_DISABLED_CONFIRMED=1`. Mutation mode создаёт durable test users, requests и feedback; он разрешён только на dedicated staging/dev с отключёнными notifications и внешним reset/cleanup после запуска.

Acceptance load выполняется только после M1 и должен быть не ниже `2×` ожидаемого launch peak. Во время запуска одновременно наблюдаются Supabase client/backend connections, ошибки `53300` и pool exhaustion, Worker `5xx`, p95/p99 и тарифные connection limits. Сам runner без Supabase/Cloudflare Observability не доказывает production capacity.

## Уборка orphaned Storage-объектов (Этап 8, L9)

Daily Cron Trigger (`wrangler.toml`, `crons = ["0 3 * * *"]`) вызывает `scheduled` в `worker.ts`, который запускает `runStorageCleanup` (`src/lib/storageCleanup.ts`). Джоба постранично перечисляет объекты бакета `card-images` строго под префиксом `cards/`, принимает только пути вида `cards/<uuid>.(jpg|png|webp)`, рассматривает объекты старше 7 суток (`CLEANUP_GRACE_PERIOD_DAYS`) и сверяет их с `card_images.storage_path` (batch-запросом, затем повторно — непосредственно перед удалением, чтобы закрыть race window). Удаление — через отдельный строгий helper (`deleteStorageObjectsStrict` в `src/lib/storage.ts`), который возвращает точный список удалённых/неудалённых путей и не скрывает частичный сбой (в отличие от best-effort `deleteStorageObjects`, используемого при редактировании/удалении карточек). Один запуск ограничен `CLEANUP_MAX_SCANNED_OBJECTS` (2000) просмотренных и `CLEANUP_MAX_DELETE_PER_RUN` (500) удалённых объектов; состояние между запусками не хранится, поэтому джоба идемпотентна.

`STORAGE_CLEANUP_DRY_RUN` (`wrangler.toml [vars]`, по умолчанию `"true"`) — при dry-run джоба только логирует scanned/candidates/deleted/failed и список путей-кандидатов (без токенов, URL и PII — только `storage_path`), реального удаления не происходит. Первый production-запуск обязателен в dry-run; переключение на `"false"` (реальное удаление) — только после ручной проверки кандидатов по логам (`wrangler tail`) и отдельного deploy. Удаление необратимо: откат Cron Trigger не восстанавливает уже удалённые объекты.

Тот же daily cron при наличии приватного R2 binding `STORAGE_BACKUP` создаёт versioned snapshot
объектов `cards/` и JSON manifest. Manifest с `complete=false` означает, что сработал safety
budget или отдельный объект не скопировался; такой snapshot не считается полноценной точкой
восстановления и должен попасть в операционный разбор.
