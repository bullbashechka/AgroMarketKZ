# Деплой

## Текущий статус

- **Backend (Cloudflare Workers):** `https://agromarketkz-backend.bullbashechka.workers.dev`
- **Webapp (Cloudflare Pages):** `https://agromarketkz-webapp.pages.dev`
- **Telegram-вебхук** переключён на прод-backend.
- **Production release 25.08.2026:** Worker version
  `2494cd6d-407a-4296-b1f9-ecb993330a1f` обслуживает 100% трафика. Это secret-only successor
  проверенной code version `368b9d52-845e-4636-b9ab-8f7c5618dae7`, созданный удалением
  неиспользуемого прямого `DATABASE_URL` после зелёных 15-минутных волн 5% и 25%.
  Pages production deployment:
  `5149c53c-feb3-45a2-9cfa-df6156d92c5e`.
- **Production DB:** native Supabase migration history Local = Remote до `20260825000119`;
  runtime идёт через Hyperdrive от роли `agromarket_runtime` без superuser/DDL и с `BYPASSRLS`.
- Прод-секреты (`PAGES_PROXY_SECRET`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `ADMIN_ALLOWLIST`, `ADMIN_OWNER_TELEGRAM_ID`, `SUPABASE_SERVICE_ROLE_KEY`) задаются через `wrangler secret put`; Worker не должен иметь прямой production `DATABASE_URL` при включённом Hyperdrive.
- Backend использует Hyperdrive `agromarketkz-backend-prod` (Supavisor session mode `:5432`, SQL cache disabled, origin limit 5), KV `agromarketkz-auth-cache-prod` и explicit Placement `aws:ap-northeast-1` рядом с production Supabase.
- Release-hardening поставлен: opaque HttpOnly-сессии, same-origin Pages proxy, durable Telegram
  webhook/Queue, upload claims и строгий auth-cache mode. Четыре Queue-ресурса существуют;
  consumers подключены только к `agromarketkz-notifications-prod` и
  `agromarketkz-telegram-updates-prod`, обе DLQ не имеют consumers.
- Persisted Worker logs включены. Production preflight 27.08.2026 подтвердил наличие отдельного
  `CF_ANALYTICS_API_TOKEN` и Queue bindings; owner подтвердил test notification. Следующий canary
  по-прежнему fail-closed: analytics query, четыре alerts и delivery receipt должны быть зелёными
  непосредственно перед каждой волной.
- **GitHub Actions не используется** — CI/CD полностью на стороне Cloudflare. `.github/workflows/ci.yml` удалён.
- **Webapp (Cloudflare Pages) деплоится автоматически**: проект `agromarketkz-webapp` привязан к репозиторию через Git-интеграцию Cloudflare Pages (не GitHub Actions) — любой пуш в любую ветку собирает preview-деплой, пуш в `main` собирает production. В Production environment заданы `BACKEND_ORIGIN`, `PAGES_PROXY_SECRET` и `SUPABASE_URL`; `VITE_API_URL` больше не нужен, потому что браузер обращается только к same-origin `/api`. Старый `CSP_ENFORCE` код не читает, его можно удалить из Dashboard.
- Pages Function `functions/api/[[path]].js` требует secret `BACKEND_ORIGIN` (Worker origin) и тот же `PAGES_PROXY_SECRET`, что Worker. Она добавляет proxy proof, protocol header `X-Agromarket-Proxy-Version: 1` и отвергает cross-origin mutation либо клиентские internal proxy headers до Worker; без обоих secret production release блокируется. Worker временно принимает отсутствие version header (legacy Pages) или `1`, но отклоняет любую другую версию. После подтверждённого rollout обеих сторон можно отдельным изменением сделать `1` обязательной.
- **Backend (Cloudflare Workers) деплоится только вручную** — Git-интеграция Worker должна быть отключена в Dashboard: `agromarketkz-backend` → Settings → Build → Disconnect. Это не относится к Pages-проекту и не отключает его auto-deploy.
- Preview Pages остаются автоматическими. Production merge разрешён только после ручного `bun run release:verify` на изолированных E2E ресурсах (см. «Проверки перед деплоем»).

## Осталось сделать вручную (BotFather)

Через переписку с @BotFather в Telegram — я туда доступа не имею:

1. **Bot Settings → Menu Button** → URL `https://agromarketkz-webapp.pages.dev`
2. **`/setdomain`** → `agromarketkz-webapp.pages.dev` (иначе Login Widget в браузере не работает)

## Проверки перед деплоем (CI нет — делать руками)

```bash
bun run typecheck                 # типы во всех воркспейсах
bun run security:deps             # high/critical dependency advisories = 0
cd backend && bun test && cd ..   # юнит-тесты backend
bun run --cwd webapp test         # чистая логика webapp
bun run build                     # прод-сборка (для webapp нужен SUPABASE_URL в env)
```

Полный блокирующий gate:

```bash
bun run release:verify
```

Он требует frozen install, typecheck, unit/integration, dependency audit, build и E2E. High/critical reachable advisory, любой неуспешный шаг или E2E вне изолированных ресурсов блокируют production merge. Исключение допускается только с отдельной записью о reachability и сроком устранения.

Перед каждым релизом дополнительно:

- В Worker Settings → Build нет Git repository и нет build/deploy command. Если подключение появилось, нажать **Disconnect** до любых migration/deploy действий. Pages Git-интеграция при этом остаётся включённой.
- В Worker Variables and Secrets есть `APP_ENV=production`; в Pages Production есть равные по значению `PAGES_PROXY_SECRET` и `BACKEND_ORIGIN=https://agromarketkz-backend.bullbashechka.workers.dev`.
- В Queues существуют `agromarketkz-notifications-prod`, `agromarketkz-notifications-dlq-prod`,
  `agromarketkz-telegram-updates-prod` и `agromarketkz-telegram-updates-dlq-prod`. Обычный
  `wrangler deploy` синхронизирует consumers из `wrangler.toml`; `versions upload` / `versions deploy`
  этого не делает. При gradual rollout service-level consumers сверять отдельно после 100%:
  consumer должен быть только у двух основных очередей, а не у DLQ.
- Supabase Security и Performance Advisors — ноль `ERROR`/`WARN`; тринадцать
  `INFO rls_enabled_no_policy` для закрытых backend-only таблиц ожидаемы после применения 0012.
- После 0015–0021 проверить `app_private.schema_migrations`, `user_sessions`,
  `telegram_auth_cutoffs`, `telegram_updates`, `card_image_upload_claims`, `notification_outbox` и
  `admin_audit_outbox`; pending/processing rows должны быть нулевыми после recovery, а
  `dead_letter` audit rows — отдельно посчитаны и разобраны оператором. Queue backlog/DLQ должны
  быть нулевыми на canary и после каждой волны.
- В Workers Observability создать email alerts на `5xx > 1%` (минимум 20 ответов/5 минут),
  DB connection errors `>0`, Queue backlog `>100` и DLQ `>0`. Проверить получение тестового
  webhook/уведомления до включения следующей волны. Единственный owner и получатель escalation —
  владелец production `ADMIN_OWNER_TELEGRAM_ID`; он же подтверждает receipt. Обе DLQ намеренно
  не имеют consumers: сначала `wrangler queues info <name>` (bounded inspect конфигурации), затем
  зафиксировать depth в Observability; автоматический redrive запрещён. Notification outbox можно
  replay только после dry-run и сверки idempotency из TD-003B; Telegram updates с poison payload
  остаются в quarantine до отдельного разбора. Runtime telemetry fail-open, а этот checklist
  fail-closed: без token, query и подтверждённого test notification волна не начинается.

  Минимальная Analytics Engine query (одна панель, 5 минут; dimensions не содержат PII):

  ```sql
  SELECT blob1 AS kind, blob2 AS operation, blob3 AS outcome,
         count() AS count, avg(double1) AS avg_duration_ms,
         max(double2) AS max_quantity
  FROM agromarketkz_requests
  WHERE timestamp > NOW() - INTERVAL '5' MINUTE
  GROUP BY kind, operation, outcome
  ```
- Проверить production `ADMIN_ALLOWLIST`: владелец `1295392762` и оператор видят раздел
  «Управление», посторонний аккаунт получает `403`; в `wrangler tail` нет предупреждений
  про синтетические id.
- `bun run test:e2e` запускается только с отдельными `E2E_DATABASE_URL`, `E2E_SUPABASE_URL`,
  Storage bucket/service key и Telegram/JWT secrets из `.env.e2e`. Корневой `.env` не
  наследуется и читается только как production baseline: для удалённых E2E-БД/Supabase он
  обязателен, а полностью локальная конфигурация может работать без него. Конфигурация с
  production URL/секретом отклоняется до старта серверов, а уже запущенные dev-серверы не
  переиспользуются. На бесплатном Supabase без отдельного проекта E2E ожидаемо останавливается
  безопасной проверкой и не создаёт записи.
- Данные E2E помечаются уникальным `[e2e:<run-id>]`, а синтетические Telegram id генерируются
  отдельно для каждого run. Global teardown напрямую вызывает test-only cleanup helper и синхронно удаляет только этот
  префикс в карточках, категориях, заявках, feedback, Storage и тестовых профилях и строго сообщает
об ошибках удаления. Storage удаляется перед SQL-транзакцией, поэтому повтор teardown может
использовать сохранённые ссылки после временного сбоя; старые префиксы намеренно не удаляются автоматически, чтобы не затронуть
  параллельный прогон. После проверки, что активных прогонов нет, такие leftovers удаляются
  отдельной ручной операцией по конкретному префиксу.
- Signed uploads E2E используют `e2e/<run-id>/`. Teardown перечисляет этот префикс, удаляет
  unbound-файлы и при потерянном ответе DELETE подтверждает отсутствие объекта через HEAD;
  production-загрузки по-прежнему используют `cards/<uuid>.<ext>`.
- `bun run load:test` также не запускать против корневого `.env`: auth journey создаёт
  пользователей, а mutation mode — заявки и обратную связь.

## Производительность backend

31.07.2026 задеплоена production version `d9e7145b-3b7a-45b8-86eb-4254a866e3b3` с
Hyperdrive, auth-cache KV и Tokyo Placement. Synthetic smoke `auth → profile → categories → cards`
вернул `200` на всех маршрутах; созданная smoke-запись удалена и повторно проверена как
отсутствующая. Наблюдавшиеся warm timings из Алматы после выкладки: профиль `474–501 мс`,
категории `393–530 мс`, карточки `403–463 мс`.

Перед 5% canary нужен production-like staging (или отдельный Supabase project) и
`LOAD_TEST_USERS=2000`, `LOAD_TEST_CONCURRENCY=200`, `LOAD_TEST_DURATION_SECONDS=1200`.
Запускать mutation/load auth против production запрещено: auth journey создаёт пользователей,
а mutation mode — заявки и feedback. GO-порог: p95 чтения < 1s, p99 < 2s, `5xx = 0`,
DB connection errors = 0, outbox sent/delivered = 100%, DLQ = 0.

До canary в Supabase Dashboard включить PITR минимум на 7 дней и выполнить restore drill в
отдельный project/clone. Supabase daily DB backup не включает Storage objects; для них нужен
приватный R2 bucket с 90-дневным immutable Bucket Lock и успешный `storageBackup` manifest с
`complete=true` (не только наличие файла manifest).

## Rollout release-hardening

1. Заморозить административные записи, применить 0015–0021 через Supabase CLI, выдать
   `agromarket_runtime` grants для `app_private`, обновить Hyperdrive credentials и затем
   read-only проверить RLS, grants, ledger, `notification_outbox` и `admin_audit_outbox`.
2. Развернуть Worker и выполнить 0% smoke: `/health`, Mini App auth, Widget exchange, каталог,
   заявка, feedback, админский список и одно Telegram-событие.
3. Включить gradual deployment `5% → 25% → 100%`; на каждой волне ждать минимум 15 минут и
   проверять `5xx`, DB connection errors, p95/p99, Queue backlog, DLQ и outbox `sent`.
4. Немедленный rollback на предыдущую Worker version при любом из условий: `5xx > 1%` при
   20+ ответах/5 минут, DB connection error `>0`, Queue DLQ `>0`, потеря уведомления или
   p95 чтения >1 секунды два окна подряд. Pages переключать после зелёного backend canary.

Если всё применимое зелёное — деплой.

Rollout 25.08.2026 завершён: 5% — 180/180 health и 180/180 Pages API, p95 `519/487 мс`;
25% — 180/180 и 180/180, p95 `498/525 мс`. Error-tail новой version был пуст. Один health
request на 25% занял 2,483 с, но p95 остался ниже 1 с и повторного окна деградации не было.
Pages пришлось восстановить до завершения backend canary: предыдущий deployment возвращал SPA
HTML на `/api/*`, потому что Functions bundle отсутствовал. После deployment из `webapp/`
`/api/health` стабильно возвращает backend JSON.

## Деплой backend

Перед первым деплоем release-hardening создать инфраструктуру (команды требуют отдельного
Cloudflare API token с ограниченным scope; автоматически они не запускаются):

```bash
cd backend
./node_modules/.bin/wrangler queues create agromarketkz-notifications-prod
./node_modules/.bin/wrangler queues create agromarketkz-notifications-dlq-prod
./node_modules/.bin/wrangler queues create agromarketkz-telegram-updates-prod
./node_modules/.bin/wrangler queues create agromarketkz-telegram-updates-dlq-prod
./node_modules/.bin/wrangler r2 bucket create agromarketkz-storage-backup-prod
./node_modules/.bin/wrangler r2 bucket lock add agromarketkz-storage-backup-prod \
  backup-retention snapshots/ --retention-days 90
```

После создания R2 bucket снять комментарий с `[[r2_buckets]]` в `backend/wrangler.toml` и
проверить, что bucket не имеет public `r2.dev` или custom-domain доступа. Bucket Lock должен
быть immutable; backup-код пишет versioned keys и не перезаписывает snapshots.

Один раз сохранить короткоживущий deploy-токен в macOS Keychain через **Keychain Access** →
**login** → **Passwords** → **Add Password**: Name `agromarketkz-cloudflare-deploy`, Account —
ваш macOS user, Password — token. В `.dev.vars` его не хранить.

Дальше deploy Worker выполняется одной командой:

```bash
bun run --cwd backend deploy:production
```

Команда сначала ищет token в Keychain и передаёт его Wrangler только в памяти. Если token ещё
не сохранён, она использует текущую Wrangler OAuth-сессию; после её истечения один раз выполните
`cd backend && ./node_modules/.bin/wrangler login`. `wrangler.toml` содержит все production
bindings, Queue consumers и `keep_vars = true`, поэтому deploy не удаляет dashboard-managed
plain-text variables.

## Деплой webapp

Обычно не нужен — Cloudflare Pages сам собирает и деплоит webapp на каждый пуш (см. «Текущий статус» выше). Руками — только если нужно задеплоить локальные незапушенные изменения или обойти сборку Pages:

```bash
SUPABASE_URL="https://qxyieyzfdcosmmckyocm.supabase.co" \
bun run --cwd webapp build

cd webapp
../backend/node_modules/.bin/wrangler pages deploy dist \
  --project-name agromarketkz-webapp --branch main --commit-dirty=true
```

Команду deploy запускайте из `webapp/`: только так Wrangler автоматически включает
`webapp/functions` в Pages Functions bundle. После deployment `/api/health` должен возвращать
JSON backend, а не `index.html`; HTML на `/api/*` означает, что proxy function не попала в сборку.

## Обновление секретов

```bash
cd backend
CLOUDFLARE_API_TOKEN="$(security find-generic-password -s agromarketkz-cloudflare-deploy -w)" \
  ./node_modules/.bin/wrangler secret put ИМЯ_СЕКРЕТА
```

Если Wrangler сообщает, что latest version не развернута, команда ничего не изменила.
Не выкатывать неизвестную latest version ради секрета: сначала сверить active/latest через
`wrangler deployments list` и `wrangler versions list`, затем либо обновить секрет в Dashboard
с явным Deploy, либо осознанно создать `wrangler versions secret put` и развернуть полученную
версию. После смены `ADMIN_ALLOWLIST` владелец сразу проверяет раздел «Управление».

## Миграции БД

Production-миграции выполняются только через explicit-version wrapper. Перед каждой операцией
`bun run db:migrations:check` должен подтвердить SHA-256 manifest-а, immutable historic remote
prefix и детерминированные symlink. Исторический `app_private.schema_migrations` сверяется
read-only; `migration repair` и legacy runner в production запрещены.

Current inventory от 26.08.2026: native Supabase ledger содержит версии до
`20260825000119`; `20260826055721` и `20260826080000` pending. Не применять их этой задачей.
Следующая production migration разрешается только одной явно указанной версией и только когда
она является первой не применённой в порядке ledger:

```bash
MIGRATION_TARGET_ENV=production \
MIGRATION_EXPECT_VERSION=<14-digit-version> \
  bun run db:migrate:production:preflight

MIGRATION_TARGET_ENV=production \
MIGRATION_EXPECT_VERSION=<same-version> \
MIGRATION_CONFIRM=APPLY:<same-version> \
  bun run db:migrate:production
```

Preflight читает `supabase_migrations.schema_migrations`, rejects missing/unknown/out-of-order
drift и запускает `supabase db push --linked --dry-run` с временным curated migration-set только
до выбранной версии; apply повторяет preflight непосредственно перед push. Для destructive migration дополнительно нужна включённая PITR, успешный restore drill
и `MIGRATION_PITR_CONFIRMED=PITR:<same-version>`. После применения выполнить verification SQL
из `database/migrations/manifest.json` и убедиться, что `supabase migration list --linked`
показывает Local = Remote.

### Runtime DB role (обязательный blocker до canary)

`DATABASE_URL`/Hyperdrive должны использовать отдельную login-роль приложения, а не
`postgres`, `supabase_admin` или роль, которой выполняются миграции. Приложение намеренно
работает с backend-only таблицами без пользовательских RLS policies, поэтому роль получает
`BYPASSRLS`, но остаётся без superuser/DDL-возможностей; миграционный URL хранится отдельно и
в Worker не передаётся:

```sql
-- Выполнить один раз административным подключением, с новым случайным паролем.
create role agromarket_runtime login password '<GENERATED-RANDOM-PASSWORD>'
  nosuperuser nocreatedb nocreaterole noinherit bypassrls;

grant connect on database postgres to agromarket_runtime;
revoke create on schema public, app_private from public;
grant usage on schema public, app_private to agromarket_runtime;
grant select, insert, update, delete on all tables in schema public to agromarket_runtime;
grant select, insert, update, delete on table
  app_private.widget_auth_proofs,
  app_private.user_sessions,
  app_private.telegram_auth_cutoffs,
  app_private.telegram_updates,
  app_private.card_image_upload_claims
to agromarket_runtime;
grant select, insert, update on table app_private.notification_outbox to agromarket_runtime;
grant select, insert, update on table app_private.admin_audit_outbox to agromarket_runtime;
grant insert on table app_private.admin_audit_events to agromarket_runtime;
grant select on table app_private.privacy_holds to agromarket_runtime;
grant usage, select on all sequences in schema public to agromarket_runtime;
grant execute on function pg_catalog.gen_random_uuid() to agromarket_runtime;
grant execute on function extensions.gen_random_uuid() to agromarket_runtime;
grant execute on function public.set_updated_at() to agromarket_runtime;

-- Повторить для фактической роли-владельца таблиц (проверить через pg_class.relowner).
alter default privileges for role <SCHEMA_OWNER_ROLE> in schema public
  grant select, insert, update, delete on tables to agromarket_runtime;
alter default privileges for role <SCHEMA_OWNER_ROLE> in schema public
  grant usage, select on sequences to agromarket_runtime;
-- Для новых app_private таблиц выдавать точечный grant в самой миграции;
-- ledger schema_migrations runtime-роли не нужен.
```

После применения 0014–0021 выдать этой роли grants для созданных `app_private` таблиц. Затем
обновить origin credentials у production Hyperdrive `2a6a43b891504d61af053a17ca5aa598`
на эту роль. После успешного Hyperdrive smoke удалить legacy Worker secret `DATABASE_URL`:
production runtime не использует прямой fallback, а migration URL в Worker передавать нельзя.
Пароль нельзя печатать в логах. Затем проверить read-only подключением:

```sql
select rolname, rolsuper, rolcreaterole, rolcreatedb, rolbypassrls
from pg_roles where rolname = 'agromarket_runtime';

select has_table_privilege('agromarket_runtime', 'public.users', 'select') as can_read_users,
       has_table_privilege('agromarket_runtime', 'app_private.notification_outbox', 'insert')
         as can_write_outbox,
       has_table_privilege('agromarket_runtime', 'app_private.telegram_auth_cutoffs', 'select')
         as can_read_auth_cutoffs,
       has_table_privilege('agromarket_runtime', 'app_private.telegram_auth_cutoffs', 'insert')
         as can_insert_auth_cutoffs,
       has_table_privilege('agromarket_runtime', 'app_private.telegram_auth_cutoffs', 'update')
         as can_update_auth_cutoffs,
       has_table_privilege('agromarket_runtime', 'app_private.telegram_auth_cutoffs', 'delete')
         as can_delete_auth_cutoffs,
       has_table_privilege('agromarket_runtime', 'app_private.privacy_holds', 'select')
         as can_read_privacy_holds,
       has_table_privilege('agromarket_runtime', 'app_private.admin_audit_events', 'insert')
         as can_append_audit,
       has_table_privilege('agromarket_runtime', 'app_private.admin_audit_outbox', 'insert')
         as can_write_audit_outbox,
       has_table_privilege('agromarket_runtime', 'app_private.admin_audit_outbox', 'update')
         as can_update_audit_outbox,
       has_table_privilege('agromarket_runtime', 'app_private.admin_audit_events', 'delete')
         as can_delete_audit;
```

Ожидается `rolsuper=false`, `rolcreaterole=false`, `rolcreatedb=false`, `rolbypassrls=true` и
`true/true/true/true/true/true/true/true/true/true/false` для одиннадцати проверок. Если проект не позволяет создать такую роль, canary блокируется:
оставлять `postgres` в Worker нельзя.

Для контроля admin-audit recovery использовать read-only запрос:

```sql
select status, count(*)
from app_private.admin_audit_outbox
group by status
order by status;

select id, request_id, attempts, last_error, dead_lettered_at
from app_private.admin_audit_outbox
where status = 'dead_letter'
order by dead_lettered_at;
```

`dead_letter` — намеренно терминальное состояние, а не тихо отброшенное событие. После устранения
причины оператор может переоткрыть конкретную строку и запустить recovery:

```sql
update app_private.admin_audit_outbox
set status = 'pending', attempts = 0, next_attempt_at = now(),
    processing_at = null, processing_token = null, dead_lettered_at = null,
    last_error = null, sent_at = null
where id = '<OUTBOX-UUID>' and status = 'dead_letter';
```

Нельзя редактировать или удалять строки `app_private.admin_audit_events`; при retention ссылка на
физически удалённого пользователя очищается через `ON DELETE SET NULL`, а append-only история и
скалярные PII-free metadata сохраняются.

Перед baseline обязательны read-only проверки RLS/grants ниже. На staging сначала выполняется
полный прогон `0001`→latest; повторный запуск уже применённых файлов не выполняется.

Для нового окружения `0012_card_update_mutations.sql` применяется только в общей ordered
последовательности через Supabase CLI. В текущем production она уже зарегистрирована; повторно
SQL не выполнять. После миграций выполнить финальную проверку RLS для всех прикладных таблиц:

```sql
select c.relname, c.relrowsecurity
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in (
    'users', 'categories', 'cards', 'card_images', 'card_specs',
    'favorites', 'requests', 'feedback_messages', 'platform_settings',
    'territories', 'card_service_territories', 'request_service_territories',
    'card_update_mutations'
  )
order by c.relname;

select *
from information_schema.role_table_grants
where table_schema = 'public'
  and grantee in ('anon', 'authenticated');

select d.defaclrole::regrole, d.defaclobjtype,
       case when e.grantee = 0 then 'PUBLIC' else e.grantee::regrole::text end as grantee,
       e.privilege_type
from pg_default_acl d
cross join lateral aclexplode(d.defaclacl) e
where d.defaclnamespace = 'public'::regnamespace
  and (e.grantee in ('anon'::regrole, 'authenticated'::regrole) or e.grantee = 0);
```

Ожидается `relrowsecurity = true` у всех тринадцати таблиц, ноль table grants и ноль строк
default ACL для `anon` / `authenticated` / `PUBLIC`. Hosted Supabase может запретить роли `postgres`
менять defaults владельца `supabase_admin`; тогда миграция выдаёт `WARNING`, а в Dashboard →
Project Settings → Data API нужно отключить автоматическую публикацию новых таблиц и повторить
последний запрос. Затем повторно запустить Security Advisor: тринадцать INFO допустимы, новых
`ERROR`/`WARN` быть не должно. Внешняя проверка с anon-ключом должна вернуть
`permission denied for table users`, после чего проверить каталог, загрузку/показ фото и один
админский endpoint. Схему `storage` миграция намеренно не меняет.

После `0011_territories_and_listing_data.sql` отдельно проверить, что опубликованных карточек
без структурированной географии не осталось:

```sql
select c.id, c.type, c.title, c.location
from cards c
where c.published_at is not null
  and c.archived_at is null
  and (
    (c.type = 'product' and c.territory_code is null)
    or (
      c.type = 'service'
      and not c.service_all_kazakhstan
      and not exists (
        select 1 from card_service_territories cst where cst.card_id = c.id
      )
    )
  )
order by c.type, c.title;
```

Ненулевой результат проверки географии требует ручного backfill и повторной проверки до
публикации новых территориальных фильтров. После успешной финальной RLS-проверки миграция
0012 безопасна для существующих карточек и не требует backfill.

Миграция [`0013_product_catalog_filters.sql`](./database/migrations/0013_product_catalog_filters.sql)
добавляет признак товарной категории, группу продукции, объём в тоннах и фильтры товарного каталога.
Она намеренно скрывает все активные товары и очищает их устаревшее поле `availability`, но не удаляет
карточки, заявки или избранное. В текущем production она уже применена; SQL повторно не выполнять.
Для нового окружения после ordered Supabase CLI migration проверить:

```sql
select count(*) as active_products_with_old_availability
from cards
where type = 'product'
  and availability is not null;

select count(*) as visible_products_after_migration
from cards
where type = 'product'
  and published_at is not null
  and archived_at is null;
```

Ожидается ноль в обоих результатах. После этого администратор отмечает товарные категории,
заполняет область, цену, объём, форму собственности и местонахождение и публикует карточки
вручную. Дополнительно убедитесь, что новые поля, ограничения и индексы действительно существуют:

```sql
select table_name, column_name, data_type, numeric_precision, numeric_scale
from information_schema.columns
where table_schema = 'public'
  and ((table_name = 'categories' and column_name = 'is_commodity')
    or (table_name = 'cards' and column_name in ('commodity_group', 'volume_tonnes'))
    or (table_name = 'requests' and column_name in ('submission_commodity_group', 'submission_volume_tonnes')))
order by table_name, column_name;

select conrelid::regclass as table_name, conname, convalidated
from pg_constraint
where conname in (
  'categories_commodity_type', 'cards_commodity_group_valid', 'cards_volume_tonnes_valid',
  'cards_commodity_fields_shape', 'cards_product_territory_region',
  'cards_published_price_complete', 'cards_published_product_fields_complete',
  'requests_submission_commodity_group_valid', 'requests_submission_volume_tonnes_valid',
  'requests_submission_product_territory_region', 'requests_listing_submission_shape'
)
order by table_name, conname;

select indexrelname
from pg_stat_user_indexes
where schemaname = 'public'
  and indexrelname in ('cards_published_product_group_idx', 'cards_published_product_volume_idx')
order by indexrelname;
```

### Порядок rollout для 0012/0013 и кода

Выполняйте шаги с замороженными административными записями. Production SQL и deploy в этой
доработке не выполнялись.

1. Заморозить административные записи, создать и проверить `agromarket_runtime`, применить
   `0012_card_update_mutations.sql`, проверить RLS/grants запросами выше.
2. Точечно применить `0013_product_catalog_filters.sql`, проверить новые колонки, ограничения,
   индексы и нулевые значения `active_products_with_old_availability` и
   `visible_products_after_migration`.
3. С feature-ветки вручную выкатить Worker, содержащий recovery PUT и товарный каталог. До
   merge проверить старые Pages smoke-маршруты: профиль, категории, товары и один админский
   endpoint; убедиться, что миграции не вернули старые товары в публикацию.
4. После зелёного smoke выполнить merge/push в `main`: Cloudflare Pages соберёт новую webapp
   автоматически. Повторить smoke для фильтров товаров, публикации карточки и recovery PUT.
5. Снять freeze записей только после успешной проверки Worker и Pages. При ошибке остановиться
   на предыдущем шаге и не запускать корневой `bun run db:migrate`.

## Регламент апгрейда Supabase

- До нагрузочного теста проверить в Billing, что spend cap не заблокирует ручной upgrade.
- На этапе 13 покупать upgrade, если p95 профиля превышает 1 секунду или появляются любые
  ошибки подключения к БД.
- После релиза покупать upgrade при доле `5xx > 1%` либо ошибках пула в логах.
- Апгрейд выполнять только в паузе между волнами рассылки: рестарт БД даёт примерно две
  минуты недоступности. До триггера остаёмся на Micro.
- PITR 7 дней и restore drill обязательны до canary; смена региона БД остаётся отдельным
  решением и в этот релиз не входит.

## Токены и локальные secret-файлы

- Неиспользуемый `CI_CLOUDFLARE_API_TOKEN` подлежит отзыву вручную до release. Deploy token создаётся короткоживущим, с минимальными правами на один account/project, и не хранится в `.dev.vars`.
- После ручной ротации выставить для `.env`, `.env.e2e` и `backend/.dev.vars` права `0600`; хранить значения в Keychain или secret manager, не в документации и не в git.
- До canary вручную задать `PAGES_PROXY_SECRET` и `ADMIN_OWNER_TELEGRAM_ID`; Pages Function и Worker получают одинаковый proxy secret. Не печатать их при проверках.
