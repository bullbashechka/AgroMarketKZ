# backend

REST API на **Hono**, работает на двух рантаймах из одного кода: локально на **Bun** (`src/index.ts`) и на **Cloudflare Workers** (`src/worker.ts`). База — **PostgreSQL** через [postgres.js](https://github.com/porsager/postgres). Валидация запросов/ответов — Zod-схемы из `@agromarket/contracts`.

## Запуск

```sh
bun run dev          # Bun, watch, http://localhost:3000
bun run dev:worker   # эмуляция Cloudflare Workers (wrangler dev)
bun run typecheck
bun test
```

Переменные окружения локально читаются из корневого `.env` (`Bun.env`), на Workers — из `c.env` (см. `wrangler.toml` и `wrangler secret put`). Требуются: `DATABASE_URL`, `JWT_SECRET`, `TELEGRAM_BOT_TOKEN`, `ADMIN_ALLOWLIST`, `WEBAPP_ORIGIN`.

CORS разрешает только точный `WEBAPP_ORIGIN` (сравнение origin запроса, без wildcard и без localhost-fallback в коде): production-значение в `wrangler.toml` — `https://agromarketkz-webapp.pages.dev` (домен детерминирован именем Cloudflare Pages проекта). Локально `wrangler dev` переопределяет его через `backend/.dev.vars` (не в git), обычный `bun run dev` — через корневой `.env`.

## Структура

```
src/
  app.ts            # фабрика createApp(): middleware окружения, CORS, onError, монтаж роутов
  index.ts          # точка входа Bun (Bun.serve)
  worker.ts         # точка входа Cloudflare Workers
  env.ts            # тип AppEnv, слияние Bun.env + c.env, getEnv(c)
  db.ts             # ленивый синглтон postgres.js
  repos/users.ts    # доступ к таблице users + маппинг в Profile
  lib/
    telegram.ts     # валидация initData и Login Widget (Web Crypto, HMAC-SHA256)
    jwt.ts          # выпуск/проверка JWT (hono/jwt, HS256, 14 дней, версия сессии)
    admin.ts        # парсинг ADMIN_ALLOWLIST, проверка прав по числовому id
    errors.ts       # HttpError (статус + сообщение)
  middleware/
    auth.ts         # requireAuth — проверка Bearer JWT
    admin.ts        # requireAdmin — живая проверка прав
  routes/
    auth.ts         # /auth/telegram, /auth/widget
    profile.ts      # /profile (GET / register / PUT)
tests/              # юнит-тесты (telegram, jwt, admin)
```

## Модель авторизации (Этап 3)

Личность подтверждается Telegram, отдельного логина/пароля нет. Две ветки входа:

- **Telegram Mini App** — клиент шлёт сырой `initData`; backend пересчитывает HMAC-подпись `TELEGRAM_BOT_TOKEN` (секрет `HMAC_SHA256("WebAppData", token)`), сверяет `hash` и свежесть `auth_date` (окно 24 ч).
- **Браузер (Telegram Login Widget)** — backend проверяет подпись с секретом `SHA256(token)`.

После успешной валидации создаётся/обновляется `User` (зеркало Telegram: id, username, имя — обновляется при каждом входе; контактные имя/телефон неприкосновенны) и выдаётся **JWT на 14 дней** (`Authorization: Bearer`). В Telegram токен молча перевыпускается из свежего `initData`, поэтому повторного входа пользователь не видит.

**Админы** определяются по `ADMIN_ALLOWLIST` (числовые Telegram id, через запятую). Проверка живая на каждом запросе (`requireAdmin`), статус в токен не зашит — выдача/снятие прав мгновенны.

## JWT-сессии и отзыв

JWT выпускается на 14 дней с claims `sub`, `tgId`, `ver`, `iat` и `exp`. `requireAuth` проверяет подпись и форму claims, затем одним запросом к `users` сверяет существование пользователя, его `telegram_id` и `token_version`. Удалённый пользователь или несовпадение версии получают `401`; сбой БД остаётся серверной ошибкой.

Миграция `0006_user_token_version.sql` добавляет `users.token_version`. Администратор отзывает все ранее выданные JWT пользователя запросом `POST /admin/users/:id/revoke-sessions`; маршрут возвращает `204`, либо `404` для отсутствующего UUID-пользователя. Новый вход выдаёт JWT с новой версией. Legacy JWT без `ver` и `iat` временно считается версией `0` до собственного `exp`.

## API

| Метод | Путь | Авторизация | Тело | Ответ |
|-------|------|-------------|------|-------|
| `GET` | `/health` | — | — | `{ status, app }` |
| `POST` | `/auth/telegram` | — | `{ initData }` | `{ token, profile }` |
| `POST` | `/auth/widget` | — | поля Login Widget (`id, first_name, …, hash`) | `{ token, profile }` |
| `GET` | `/profile` | Bearer | — | `Profile` |
| `POST` | `/profile/register` | Bearer | `{ contactName, contactPhone }` | `Profile` |
| `PUT` | `/profile` | Bearer | `{ contactName, contactPhone }` | `Profile` |
| `POST` | `/admin/users/:id/revoke-sessions` | Admin Bearer | — | `204` |

`contactPhone` принимается только как казахстанский мобильный (`+7 7xx`), нормализуется к `+77XXXXXXXXX`; иначе `400`. Ошибки — единый JSON `{ error, issues? }` со статусами `400/401/403/404/500`.

## Ограничение запросов и rate limiting

После CORS и до маршрутов все request bodies API ограничены 256 KiB. Переполнение возвращает `413` с JSON `{"error":"Размер запроса превышает 256 KiB"}`. Загрузка файлов по signed URL выполняется клиентом напрямую в Supabase Storage и через backend body не проходит.

В production Worker использует нативные Cloudflare Rate Limiting bindings:

- `API_READ_RATE_LIMITER`: 120 запросов за 60 секунд, ключ — `userId`;
- `API_MUTATION_RATE_LIMITER`: 30 запросов за 60 секунд, ключ — `userId:routeGroup`.

Локальный запуск без bindings работает в режиме no-op. Отказ limiter возвращает `429`, заголовок `Retry-After: 60` и JSON-поле `retryAfterSeconds: 60`. Счётчики Cloudflare являются location-local и eventually consistent, поэтому не используются как точный бизнес-счётчик; существующие бизнес-лимиты хранятся отдельно.

Перед deployment проверить namespace `2026072001` и `2026072002` на уникальность в пределах Cloudflare account. WAF для `/auth/*` и общего API остаётся production rollout: observe/log → настройка порогов по трафику → blocking. `OPTIONS` и `/telegram/webhook` исключаются из строгого общего IP-правила.

## Пул БД и нагрузочный runner

На один Worker isolate `postgres.js` явно ограничен параметрами `max: 3`, `idle_timeout: 20`, `connect_timeout: 10`, `prepare: false`; `max_lifetime` остаётся библиотечным default. Production `DATABASE_URL` должен указывать на Supabase transaction pooler через порт `6543`. Session-bound prepared statements с transaction pooler несовместимы, поэтому `prepare` не включать.

Runner запускается только вручную командой `bun run load:test`. Обязательные env guards: `LOAD_TEST_API_URL`, точное подтверждение origin в `LOAD_TEST_ALLOW_TARGET`, `LOAD_TEST_TELEGRAM_BOT_TOKEN` (или fallback `TELEGRAM_BOT_TOKEN`), `LOAD_TEST_USERS`, `LOAD_TEST_CONCURRENCY`, `LOAD_TEST_DURATION_SECONDS`. Значения ограничены сверху: 2 000 пользователей, concurrency 200 и 1 800 секунд. Даже default journey требует `LOAD_TEST_ALLOW_TARGET`, поскольку `/auth/telegram` выполняет DB upsert. Oversized probe выполняется один раз и требует `413`.

`LOAD_TEST_RATE_LIMIT_PROBE=1` включает отдельного пользователя. После отдельной auth с request timeout 30 секунд runner выполняет read burst с абсолютным deadline 45 секунд — короче 60-секундного limiter window — и максимумом 200 запросов. Запросы планируются batches по 10 с фиксированной concurrency 10; после первого `429` новые batches не планируются, а все уже in-flight responses полностью consumed/settled. Runner проверяет положительный `Retry-After` и совпадающий `retryAfterSeconds`. Из-за location-local/eventually consistent счётчиков Cloudflare отсутствие `429` в пределах deadline/лимита считается провалом probe и оценивается в контексте конкретной location.

Default mode не вызывает `/profile/register`, `/requests` и `/feedback`. `LOAD_TEST_ENABLE_MUTATIONS=1` дополнительно требует `LOAD_TEST_ALLOW_WRITE_TARGET`, точно равный origin, и `LOAD_TEST_NOTIFICATIONS_DISABLED_CONFIRMED=1`. Mutation mode создаёт durable test users, requests и feedback; он разрешён только на dedicated staging/dev с отключёнными notifications и внешним reset/cleanup после запуска.

Acceptance load выполняется только после M1 и должен быть не ниже `2×` ожидаемого launch peak. Во время запуска одновременно наблюдаются Supabase client/backend connections, ошибки `53300` и pool exhaustion, Worker `5xx`, p95/p99 и тарифные connection limits. Сам runner без Supabase/Cloudflare Observability не доказывает production capacity.

## Уборка orphaned Storage-объектов (Этап 8, L9)

Daily Cron Trigger (`wrangler.toml`, `crons = ["0 3 * * *"]`) вызывает `scheduled` в `worker.ts`, который запускает `runStorageCleanup` (`src/lib/storageCleanup.ts`). Джоба постранично перечисляет объекты бакета `card-images` строго под префиксом `cards/`, принимает только пути вида `cards/<uuid>.(jpg|png|webp)`, рассматривает объекты старше 7 суток (`CLEANUP_GRACE_PERIOD_DAYS`) и сверяет их с `card_images.storage_path` (batch-запросом, затем повторно — непосредственно перед удалением, чтобы закрыть race window). Удаление — через отдельный строгий helper (`deleteStorageObjectsStrict` в `src/lib/storage.ts`), который возвращает точный список удалённых/неудалённых путей и не скрывает частичный сбой (в отличие от best-effort `deleteStorageObjects`, используемого при редактировании/удалении карточек). Один запуск ограничен `CLEANUP_MAX_SCANNED_OBJECTS` (2000) просмотренных и `CLEANUP_MAX_DELETE_PER_RUN` (500) удалённых объектов; состояние между запусками не хранится, поэтому джоба идемпотентна.

`STORAGE_CLEANUP_DRY_RUN` (`wrangler.toml [vars]`, по умолчанию `"true"`) — при dry-run джоба только логирует scanned/candidates/deleted/failed и список путей-кандидатов (без токенов, URL и PII — только `storage_path`), реального удаления не происходит. Первый production-запуск обязателен в dry-run; переключение на `"false"` (реальное удаление) — только после ручной проверки кандидатов по логам (`wrangler tail`) и отдельного deploy. Удаление необратимо: откат Cron Trigger не восстанавливает уже удалённые объекты.
