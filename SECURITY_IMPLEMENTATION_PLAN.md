# План реализации исправлений SECURITY_AUDIT.md

**Дата плана:** 2026-07-19  
**Основание:** [SECURITY_AUDIT.md](./SECURITY_AUDIT.md) и read-only проверка актуального кода моделью Terra.  
**Скоуп:** backend, webapp, shared contracts, PostgreSQL/Supabase Storage, Cloudflare Workers/Pages и предрелизная валидация.

Документ содержит только план. Реализация, применение миграций и изменение облачных ресурсов выполняются отдельными задачами.

## 1. Уточнения к исходному аудиту

- `GET /settings` больше не публичный: весь router требует JWT, а полный набор контактов дополнительно требует завершённую регистрацию ([backend/src/routes/settings.ts](./backend/src/routes/settings.ts)). Поэтому `Cache-Control: public` для этого ответа применять нельзя.
- `postgres.js` уже ограничивает пул до трёх соединений в Cloudflare runtime, но это поведение не закреплено явно в [backend/src/db.ts](./backend/src/db.ts). Риск M5 ниже заявленного, однако конфигурацию и нагрузку необходимо зафиксировать.
- Ограничения MIME и размера из L3 должны задаваться на уровне Supabase bucket через `allowed_mime_types` и `file_size_limit`, а не как параметры отдельного signed upload URL.
- Внешнее правило размера request body на Cloudflare зависит от тарифа. Application-level лимит Hono остаётся обязательным и основным рубежом.

## 2. Приоритеты

| Приоритет | Findings | Цель |
|---|---|---|
| P0 — release gate | M2, M3, M5, L2 | Защитить API от DoS, ограничить request body, закрепить пул БД и production CORS |
| P1 — security hardening | M1, M4, L1, L3, L5, L6, L7, L8 | Добавить отзыв JWT, CSP, безопасные Storage, ошибки и внешние ссылки |
| P2 — эксплуатационная устойчивость | L4, L9 | Сделать бизнес-антиспам атомарным и убирать orphaned-файлы |

## 3. Приёмочный контракт

Реализация считается завершённой, когда выполняются все условия:

1. JSON-тело больше 256 KiB получает `413` до JSON parsing и Zod validation, включая поток без `Content-Length`.
2. Flood auth/API ограничивается на Cloudflare; application-level `429` содержит `Retry-After`.
3. После отзыва сессий прежние JWT конкретного пользователя получают `401`, а новый Telegram login выдаёт рабочий токен.
4. Подписанный JWT с невалидной формой claims отклоняется.
5. `requireRegistered` не выполняет отдельный запрос к БД.
6. Production CORS разрешает только точный webapp origin и не содержит localhost/`*`.
7. CSP не ломает Telegram Web, Android/iOS Mini App, Login Widget, изображения и direct upload.
8. Public URL карточки остаётся доступен, а anonymous listing bucket запрещён.
9. Storage отклоняет неподдерживаемый MIME и файл больше 8 MiB.
10. Нагрузочный тест не показывает pool exhaustion, ошибки `53300` или неконтролируемый рост `5xx`.

## 4. Этап 1 — защита от DoS и больших запросов

### M3 — request body limit

1. Подключить встроенный `bodyLimit` из текущей версии Hono в [backend/src/app.ts](./backend/src/app.ts).
2. Ввести единую константу лимита JSON: 256 KiB.
3. Подключить middleware после CORS, но до маршрутов и вызовов `c.req.json()`.
4. Применить лимит ко всем request bodies API. Загрузка изображений не затрагивается, поскольку выполняется напрямую в Supabase Storage.
5. Через `onError` middleware возвращать стабильный JSON-ответ `413`, не допуская превращения ошибки в `500`.
6. Проверить граничный размер, завышенный `Content-Length` и stream без `Content-Length`.
7. Cloudflare body-size rule использовать только как дополнительный рубеж, если поле полного размера доступно на выбранном тарифе.

### M2 — perimeter и application rate limiting

1. Создать Cloudflare WAF Rate Limiting Rules только для production API hostname:
   - отдельное правило для `/auth/*`;
   - общий лимит API;
   - исключить CORS `OPTIONS`;
   - исключить `/telegram/webhook` из строгого общего IP-лимита;
   - сначала включить observe/log режим;
   - подобрать пороги по реальному трафику с учётом carrier NAT;
   - после проверки перевести в blocking mode.
2. Добавить нативные Cloudflare Rate Limiting bindings в [backend/wrangler.toml](./backend/wrangler.toml):
   - authenticated read-limit по `userId`;
   - более строгий mutation-limit по `userId + route group`;
   - не добавлять KV, Durable Object или стороннюю библиотеку без отдельной необходимости.
3. Не использовать Cloudflare limiter как точный бизнес-счётчик: его состояние локально для Cloudflare location и eventually consistent.
4. В [backend/src/app.ts](./backend/src/app.ts) добавлять заголовок `Retry-After` для `HttpError(429)` при наличии `retryAfterSeconds`.
5. Сохранить поле `retryAfterSeconds` в JSON для совместимости с [webapp/src/lib/api.ts](./webapp/src/lib/api.ts).
6. Не кэшировать полный `/settings` как public. Сохранить существующий клиентский `staleTime`.

## 5. Этап 2 — пул БД и нагрузка

### M5 — connection management

1. Явно закрепить параметры `postgres()` в [backend/src/db.ts](./backend/src/db.ts):
   - `max: 3`;
   - `idle_timeout: 20`;
   - `connect_timeout: 10`;
   - `prepare: false`;
   - текущий `max_lifetime` оставить без изменения до результатов нагрузки.
2. Проверить production `DATABASE_URL` без вывода секрета:
   - используется transaction pooler;
   - порт `6543`;
   - фактические client/backend connection limits тарифа;
   - текущие connection metrics в Supabase Observability.
3. Не объединять и не переписывать сложные catalog queries до появления измеренного bottleneck.
4. Нагрузочный тест выполнять после M1, поскольку live-проверка `token_version` добавит DB lookup каждому защищённому запросу.
5. Тестировать не менее двойного ожидаемого launch peak:
   - auth → profile → catalog;
   - listing categories/cards;
   - одновременные requests/feedback;
   - oversized requests;
   - rate-limit threshold.
6. Не добавлять k6/artillery как dependency репозитория без отдельного согласования; использовать внешний или уже доступный runner.

## 6. Этап 3 — отзыв JWT и runtime-валидация

### M1 и L7 — token version

1. Создать новую миграцию `database/migrations/0006_user_token_version.sql`:
   - `users.token_version integer not null default 0`;
   - `check (token_version >= 0)`;
   - индекс не добавлять, поскольку lookup выполняется по PK пользователя.
2. В [backend/src/repos/users.ts](./backend/src/repos/users.ts):
   - добавить `token_version` в `UserRow`;
   - реализовать узкий auth-state lookup по `id + telegram_id`;
   - возвращать `token_version` и `registered_at`;
   - добавить атомарный `token_version = token_version + 1`.
3. В [backend/src/lib/jwt.ts](./backend/src/lib/jwt.ts):
   - добавить claims `ver` и `iat`;
   - сократить TTL до 14 дней;
   - валидировать payload локальной Zod-схемой;
   - `sub` должен быть UUID;
   - `tgId` должен быть положительным safe integer;
   - `ver` должен быть неотрицательным integer;
   - `iat` и `exp` должны быть корректными integer timestamps;
   - проверять `exp > iat`.
4. Изменить `issueToken` так, чтобы оба auth-маршрута передавали текущий `row.token_version`.
5. В `requireAuth`:
   - сначала проверить подпись и форму JWT;
   - затем одним SELECT проверить существование пользователя, соответствие `telegram_id` и `token_version`;
   - положить в context `userId`, `telegramId` и `isRegistered`;
   - удалённого пользователя или version mismatch возвращать как `401`;
   - сбой БД не маскировать под `401`.
6. Превратить `requireRegistered` в проверку `isRegistered` из context без отдельного SQL.
7. Добавить `POST /admin/users/:id/revoke-sessions`:
   - UUID path validation;
   - атомарный increment token version;
   - `404` для отсутствующего пользователя;
   - `204` при успехе.
8. Добавить действие «Завершить сессии» в [webapp/src/screens/admin/AdminUsersScreen.tsx](./webapp/src/screens/admin/AdminUsersScreen.tsx).
9. Учесть активную сессию webapp:
   - `401` от любого защищённого запроса очищает JWT;
   - cached profile инвалидируется;
   - в Telegram выполняется один silent re-login;
   - в браузере показывается Login Widget;
   - параллельные `401` не должны запускать несколько login requests.
10. Rollout без массового разлогина:
    - legacy JWT без `ver` временно трактовать как версию `0`;
    - legacy JWT без `iat` принимать только в пределах прежнего `exp`;
    - отзыв legacy-токена работает после инкремента версии;
    - через 30 дней удалить compatibility branch и сделать `ver/iat` обязательными.

## 7. Этап 4 — security headers и CSP

### M4 — Pages headers

1. Сначала завершить L2 и определить точные production origins webapp, API и Supabase.
2. Убрать inline styles из:
   - [webapp/src/components/Skeleton.tsx](./webapp/src/components/Skeleton.tsx);
   - [webapp/src/screens/RootLayout.tsx](./webapp/src/screens/RootLayout.tsx).
3. Заменить inline styles CSS-классами, чтобы не добавлять `style-src 'unsafe-inline'`.
4. Создать `webapp/public/_headers`. После `bun run build` файл должен присутствовать как `webapp/dist/_headers`.
5. CSP должна включать:
   - `default-src 'self'`;
   - `script-src 'self' https://telegram.org`;
   - `style-src 'self'`;
   - `connect-src` с точными API и Supabase origins;
   - `img-src 'self' data: blob:` плюс Supabase origin;
   - `frame-src` для Telegram Login Widget;
   - `frame-ancestors https://web.telegram.org https://*.telegram.org`;
   - `object-src 'none'`;
   - `base-uri 'self'`.
6. Добавить:
   - `X-Content-Type-Options: nosniff`;
   - `Referrer-Policy: strict-origin-when-cross-origin`;
   - ограниченный `Permissions-Policy`.
7. Не добавлять `X-Frame-Options: DENY` или `SAMEORIGIN` — они сломают Telegram Web.
8. Добавить применимые security headers к JSON API, но не считать API CSP защитой webapp document.
9. Сначала развернуть `Content-Security-Policy-Report-Only` на preview.
10. Проверить Telegram Web, Android/iOS Mini App, Login Widget, PhotoSwipe, preview blob images, public images и direct upload.
11. После устранения violations включить enforcing CSP.

## 8. Этап 5 — production CORS

### L2 — точный origin

1. Заменить localhost-плейсхолдер в [backend/wrangler.toml](./backend/wrangler.toml) на фактический production Pages origin.
2. Не использовать `*`.
3. Сделать `WEBAPP_ORIGIN` обязательной runtime-конфигурацией.
4. Localhost разрешать только через локальный `.env`, но не как production fallback.
5. Проверять наличие `VITE_API_URL` при production build webapp.
6. Production build не должен молча использовать `http://localhost:3000`.
7. Сверить остальные production vars/secrets:
   - `SUPABASE_URL`;
   - `SUPABASE_STORAGE_BUCKET`;
   - `TELEGRAM_BOT_USERNAME`;
   - `TELEGRAM_MINIAPP_SHORTNAME`;
   - `JWT_SECRET`;
   - `TELEGRAM_BOT_TOKEN`;
   - `TELEGRAM_WEBHOOK_SECRET`;
   - `ADMIN_ALLOWLIST`;
   - `DATABASE_URL`;
   - `SUPABASE_SERVICE_ROLE_KEY`.
8. Добавить API-тесты:
   - production origin разрешён;
   - произвольный origin не получает `Access-Control-Allow-Origin`;
   - preflight работает;
   - запросы без browser Origin продолжают работать.

## 9. Этап 6 — Supabase Storage и функция БД

### L1 — запрет listing

1. Обновить [database/supabase/storage.sql](./database/supabase/storage.sql).
2. Удалить широкую policy `card-images public read`.
3. Оставить bucket публичным для direct object URLs.
4. Проверить на dev:
   - существующая картинка открывается без авторизации;
   - anonymous list bucket получает отказ;
   - service role операции продолжают работать.
5. После применения повторно запустить Supabase Security Advisor.

### L3 — MIME и размер upload

1. В bucket-level конфигурации установить:
   - `file_size_limit = 8388608`;
   - `allowed_mime_types = image/jpeg, image/png, image/webp`.
2. Сохранить текущий enum в [packages/contracts/src/upload.ts](./packages/contracts/src/upload.ts).
3. Проверить:
   - допустимый JPEG загружается;
   - файл больше 8 MiB отклоняется;
   - неподдерживаемый MIME отклоняется;
   - admin editor после JPEG compression продолжает работать.
4. Зафиксировать residual risk: bucket проверяет заявленный MIME, но не декодирует magic bytes. Для текущего admin-only upload этого достаточно; для будущих пользовательских загрузок потребуется отдельная проверка содержимого.

### L5 — immutable search path

1. Создать `database/migrations/0007_fix_function_search_path.sql`.
2. Переопределить `public.set_updated_at()` через `create or replace function`.
3. Установить `set search_path = pg_catalog`.
4. Использовать квалифицированный `pg_catalog.now()`.
5. Не изменять историческую миграцию `0001_initial_schema.sql`.
6. Триггеры не пересоздавать: они продолжают ссылаться на тот же объект функции.
7. Проверить, что Security Advisor больше не показывает `function_search_path_mutable`.

## 10. Этап 7 — остальные backend/webapp фиксы

### L4 — точный бизнес-антиспам

1. Сохранить Cloudflare limiter как внешний анти-DoS слой.
2. Для requests перенести проверку лимита внутрь существующей транзакции после блокировки строки пользователя.
3. Повторную идемпотентную отправку проверять до списания лимита.
4. Для feedback:
   - начать транзакцию;
   - заблокировать строку пользователя через `FOR UPDATE`;
   - вычислить count и oldest;
   - проверить лимит;
   - вставить feedback в той же транзакции.
5. Возвращать точный `Retry-After` для requests и feedback.
6. Сохранить бизнес-правило: не более пяти обращений за десять минут.

### L6 — безопасные validation errors

1. Убрать raw `ZodIssue[]` из публичного ответа.
2. Возвращать стабильный ответ `{ error, code: "VALIDATION_ERROR" }`.
3. Использовать одинаковый формат во всех окружениях.
4. Не менять domain errors `409` и `429`.
5. Добавить regression test, что response не содержит `issues`, schema details или stack trace.

### L8 — безопасные внешние ссылки

1. В shared contracts добавить schema/parser для `telegramContact`.
2. Разрешать только:
   - `@handle`;
   - `handle`;
   - `t.me/handle`;
   - `https://t.me/handle`.
3. Канонизировать сохраняемое значение в `https://t.me/<handle>`.
4. Отклонять:
   - `http:`;
   - `javascript:`;
   - `data:`;
   - произвольные HTTPS-hostnames;
   - malformed handle.
5. До добавления DB constraint проверить текущее значение `platform_settings.telegram_contact` и безопасно исправить его.
6. После нормализации добавить DB check constraint для канонической формы.
7. В webapp повторно проверять legacy-значение перед открытием и скрывать невалидный канал.
8. Разделить специализированные builders/openers для:
   - `tel:`;
   - `mailto:`;
   - `https://wa.me/<number>`;
   - `https://t.me/<handle>`.
9. Убрать возможность открытия произвольного URL через общий helper.

## 11. Этап 8 — уборка orphaned-файлов

### L9 — scheduled cleanup

1. Использовать существующий backend Worker, не создавать отдельную Edge Function.
2. Добавить daily Cron Trigger в [backend/wrangler.toml](./backend/wrangler.toml).
3. Добавить scheduled handler к [backend/src/worker.ts](./backend/src/worker.ts).
4. Cleanup должен:
   - постранично получать объекты только с prefix `cards/`;
   - принимать только пути `cards/<uuid>.(jpg|png|webp)`;
   - рассматривать объекты старше семи суток;
   - batch-проверкой сравнивать их с `card_images.storage_path`;
   - непосредственно перед delete повторно подтверждать отсутствие ссылки;
   - удалять только точные неподвязанные paths через Storage API;
   - иметь максимальный batch/run limit;
   - быть идемпотентным;
   - логировать scanned/candidates/deleted/failed без токенов, URL и PII.
5. Выделить strict delete helper, который возвращает результат. Не использовать для cleanup текущий best-effort helper, скрывающий частичные ошибки.
6. Первый production-запуск выполнить только в dry-run.
7. После ручной проверки кандидатов включить delete mode.
8. Учитывать необратимость удаления: rollback Cron не восстанавливает уже удалённые объекты.

## 12. Тестовый план

### Unit tests

- JWT содержит `ver` и `iat`.
- Malformed signed claims отклоняются.
- Неверная подпись и просрочка остаются `401`.
- Legacy compatibility работает только в заданном окне.
- Telegram URL parser принимает допустимые формы и отклоняет опасные.
- Storage cleanup корректно фильтрует path, age и references.
- Zod response не содержит `issues`.

### Backend integration tests

- Отозванный токен получает `401`.
- Новый login после revoke получает рабочий JWT.
- Несовпадение `sub/tgId` с БД отклоняется.
- Незарегистрированный пользователь получает `403`.
- `requireRegistered` не выполняет второй SELECT.
- Oversized `Content-Length` получает `413`.
- Stream без `Content-Length` получает `413`.
- Тело ровно на границе проходит.
- Malformed, но допустимый по размеру JSON получает `400`.
- `429` содержит `Retry-After`.
- CORS разрешает только production origin.

### E2E и ручные проверки

- Admin revoke → активная browser-сессия переходит к Login Widget.
- Admin revoke → Telegram Mini App тихо перевходит.
- Создание, редактирование и публикация карточки с изображением.
- Public image продолжает открываться.
- Anonymous listing запрещён.
- MIME/size restrictions Storage работают.
- Telegram Web iframe и Login Widget не нарушаются CSP.
- Android/iOS `requestContact`, deep links, BackButton и haptics проверяются вручную.

### Команды

```sh
bun test
bun run typecheck
bun run build
bun run test:e2e
```

Дополнительно выполнить Supabase Security Advisor и production-like нагрузочный тест.

## 13. Порядок rollout

1. Зафиксировать production origins, Supabase connection limits и доступный Cloudflare WAF plan.
2. Включить WAF в observe/log режиме.
3. Применить обратимо-совместимые миграции `token_version` и `search_path`.
4. Развернуть backend с body limit, pool config, JWT compatibility, revoke и rate-limit bindings.
5. Проверить `401/403/413/429/5xx` и DB connections на canary/staging.
6. Применить Storage hardening на dev и выполнить positive/negative проверки.
7. Применить Storage hardening на production.
8. Развернуть Pages с CSP Report-Only.
9. Выполнить E2E, Telegram smoke tests и нагрузочный тест.
10. Включить WAF blocking и enforcing CSP.
11. Запустить orphan cleanup в dry-run.
12. После проверки включить cleanup delete mode.
13. Мониторить первые 24 часа:
    - `401` и re-login;
    - `413`;
    - `429`;
    - webhook errors;
    - Worker `5xx`;
    - DB connections;
    - latency p95/p99.
14. Через 30 дней удалить поддержку legacy JWT без `ver/iat`.

## 14. Rollback

- WAF: откатывать конкретное правило или возвращать observe mode, не отключать весь perimeter.
- CSP: вернуть Report-Only или предыдущую Pages revision.
- JWT: не удалять `token_version`; при аварии временно вернуть compatibility verifier или предыдущий backend.
- DB pool: вернуть предыдущие client parameters и повторить нагрузочный тест.
- Storage policy: восстанавливать широкую SELECT-policy только если фактический public object GET неожиданно сломан и причина подтверждена.
- Storage restrictions: откатить bucket limit отдельно, не ослабляя RLS/listing без необходимости.
- Cleanup: отключить Cron; уже удалённые объекты без резервной копии не восстанавливаются.

## 15. Документация после реализации

Обновить:

- [backend/README.md](./backend/README.md): JWT TTL, token version, revoke, `413/429`, pool config.
- [database/README.md](./database/README.md): Storage listing policy, MIME/size limits, cleanup.
- [README.md](./README.md): production vars, WAF, CSP и release checks.
- [TASKS.md](./TASKS.md): статус security-hardening и deployment gates.
- [SECURITY_AUDIT.md](./SECURITY_AUDIT.md): remediation status каждого finding после фактической проверки.
- Исправить устаревший комментарий о публичности settings в [backend/src/repos/settings.ts](./backend/src/repos/settings.ts).

## 16. Зависимости между этапами

- L2 → M4: CSP требует точных production origins.
- M1 → M5 validation: live token revocation меняет профиль DB-нагрузки.
- M2 → load test: нагрузку нужно измерять с целевыми limiter rules.
- L3 → L9: bucket restrictions должны работать до включения долгоживущего cleanup.
- L1 → L9: listing следует закрыть до автоматизированной уборки.
- DB migration → JWT backend: `token_version` должен существовать до включения live проверки.

Блокирующих продуктовых решений нет. До начала реализации необходимо получить только фактические production origins, Supabase connection limits и операционные Cloudflare thresholds.
