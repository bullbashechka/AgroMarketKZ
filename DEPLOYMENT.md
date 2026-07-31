# Деплой

## Текущий статус

- **Backend (Cloudflare Workers):** `https://agromarketkz-backend.bullbashechka.workers.dev`
- **Webapp (Cloudflare Pages):** `https://agromarketkz-webapp.pages.dev`
- **Telegram-вебхук** переключён на прод-backend.
- Прод-секреты (`JWT_SECRET`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `ADMIN_ALLOWLIST`, `DATABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`) заданы через `wrangler secret put`.
- Backend использует Hyperdrive `agromarketkz-backend-prod` (Supavisor session mode `:5432`, SQL cache disabled, origin limit 5), KV `agromarketkz-auth-cache-prod` и explicit Placement `aws:ap-northeast-1` рядом с production Supabase.
- Persisted Worker logs включены. По решению владельца автоматические алерты Analytics Engine пока не активируются: secret `CF_ANALYTICS_API_TOKEN` не создаётся, ручная диагностика остаётся доступна через сохранённые Worker logs.
- **GitHub Actions не используется** — CI/CD полностью на стороне Cloudflare. `.github/workflows/ci.yml` удалён.
- **Webapp (Cloudflare Pages) деплоится автоматически**: проект `agromarketkz-webapp` привязан к репозиторию через Git-интеграцию Cloudflare Pages (не GitHub Actions) — любой пуш в любую ветку собирает preview-деплой, пуш в `main` собирает production. `VITE_API_URL`, `SUPABASE_URL`, `CSP_ENFORCE` заданы в `deployment_configs` проекта (Cloudflare dashboard → Pages → agromarketkz-webapp → Settings → Environment variables), а не через env репозитория.
- **Backend (Cloudflare Workers) деплоится только вручную** — Git-интеграции у Workers-проекта нет, см. «Деплой backend» ниже.
- Тестов/тайпчека на пуш больше нет — гонять руками (см. «Проверки перед деплоем»).

## Осталось сделать вручную (BotFather)

Через переписку с @BotFather в Telegram — я туда доступа не имею:

1. **Bot Settings → Menu Button** → URL `https://agromarketkz-webapp.pages.dev`
2. **`/setdomain`** → `agromarketkz-webapp.pages.dev` (иначе Login Widget в браузере не работает)

## Проверки перед деплоем (CI нет — делать руками)

```bash
bun run typecheck                 # типы во всех воркспейсах
cd backend && bun test && cd ..   # юнит-тесты backend
bun run --cwd webapp test         # чистая логика webapp
bun run build                     # прод-сборка (нужны VITE_API_URL и SUPABASE_URL в env)
```

Перед каждым релизом дополнительно:

- Supabase Security и Performance Advisors — ноль `ERROR`/`WARN`; девять
  `INFO rls_enabled_no_policy` для закрытых backend-only таблиц ожидаемы.
- Проверить production `ADMIN_ALLOWLIST`: владелец `1295392762` и оператор видят раздел
  «Управление», посторонний аккаунт получает `403`; в `wrangler tail` нет предупреждений
  про синтетические id.
- `bun run test:e2e` пока **не запускать**: корневой `.env` ведёт в production-БД. После
  выделения test-БД перед прогоном остановить обычный `bun run dev`, чтобы Playwright не
  переиспользовал backend с другим окружением; global setup дополнительно проверит `isAdmin`.
- `bun run load:test` также не запускать против корневого `.env`: auth journey создаёт
  пользователей, а mutation mode — заявки и обратную связь.

## Производительность backend

31.07.2026 задеплоена production version `d9e7145b-3b7a-45b8-86eb-4254a866e3b3` с
Hyperdrive, auth-cache KV и Tokyo Placement. Synthetic smoke `auth → profile → categories → cards`
вернул `200` на всех маршрутах; созданная smoke-запись удалена и повторно проверена как
отсутствующая. Наблюдавшиеся warm timings из Алматы после выкладки: профиль `474–501 мс`,
категории `393–530 мс`, карточки `403–463 мс`.

По решению владельца отдельный staging не создаётся, а максимальный load-test на 2000
синтетических пользователей не проводится. Запускать его против production запрещено: auth
journey создаёт пользователей, а mutation mode — заявки и обратную связь. Нагрузочная ёмкость
до 24k поэтому не подтверждена p50/p95/p99-тестом и остаётся принятым остаточным риском;
production smoke-test подтверждает только работоспособность оптимизированного горячего пути.

Если всё применимое зелёное — деплой.

## Деплой backend

```bash
cd backend
export CLOUDFLARE_API_TOKEN=$(grep '^CLOUDFLARE_API_TOKEN=' .dev.vars | cut -d= -f2-)
./node_modules/.bin/wrangler deploy
```

## Деплой webapp

Обычно не нужен — Cloudflare Pages сам собирает и деплоит webapp на каждый пуш (см. «Текущий статус» выше). Руками — только если нужно задеплоить локальные незапушенные изменения или обойти сборку Pages:

```bash
VITE_API_URL="https://agromarketkz-backend.bullbashechka.workers.dev" \
SUPABASE_URL="https://qxyieyzfdcosmmckyocm.supabase.co" \
CSP_ENFORCE=1 \
bun run --cwd webapp build

cd backend
export CLOUDFLARE_API_TOKEN=$(grep '^CLOUDFLARE_API_TOKEN=' .dev.vars | cut -d= -f2-)
./node_modules/.bin/wrangler pages deploy ../webapp/dist --project-name=agromarketkz-webapp
```

## Обновление секретов

```bash
cd backend
export CLOUDFLARE_API_TOKEN=$(grep '^CLOUDFLARE_API_TOKEN=' .dev.vars | cut -d= -f2-)
echo -n "новое-значение" | ./node_modules/.bin/wrangler secret put ИМЯ_СЕКРЕТА
```

Если Wrangler сообщает, что latest version не развернута, команда ничего не изменила.
Не выкатывать неизвестную latest version ради секрета: сначала сверить active/latest через
`wrangler deployments list` и `wrangler versions list`, затем либо обновить секрет в Dashboard
с явным Deploy, либо осознанно создать `wrangler versions secret put` и развернуть полученную
версию. После смены `ADMIN_ALLOWLIST` владелец сразу проверяет раздел «Управление».

## Миграции БД

Корневой `bun run db:migrate` не ведёт журнал применённых файлов и каждый раз повторяет весь
каталог. На production его не запускать: повторный `0008_telegram_contact_canonical.sql`
может обнулить вручную исправленный Telegram-контакт. Новую миграцию сначала проверять полным
прогоном `0001`→latest на отдельной безопасной БД, затем применять к production точечно через
Supabase SQL Editor или `apply_migration`.

Для `0009_enable_rls.sql` после применения проверить:

```sql
select c.relname, c.relrowsecurity
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in (
    'users', 'categories', 'cards', 'card_images', 'card_specs',
    'favorites', 'requests', 'feedback_messages', 'platform_settings'
  )
order by c.relname;

select *
from information_schema.role_table_grants
where table_schema = 'public'
  and grantee in ('anon', 'authenticated');

select d.defaclrole::regrole, d.defaclobjtype, e.grantee::regrole, e.privilege_type
from pg_default_acl d
cross join lateral aclexplode(d.defaclacl) e
where d.defaclnamespace = 'public'::regnamespace
  and e.grantee in ('anon'::regrole, 'authenticated'::regrole);
```

Ожидается `relrowsecurity = true` у всех девяти таблиц, ноль table grants и ноль строк
default ACL для `anon` / `authenticated`. Hosted Supabase может запретить роли `postgres`
менять defaults владельца `supabase_admin`; тогда миграция выдаёт `WARNING`, а в Dashboard →
Project Settings → Data API нужно отключить автоматическую публикацию новых таблиц и повторить
последний запрос. Затем повторно запустить Security Advisor: девять INFO допустимы, новых
`ERROR`/`WARN` быть не должно. Внешняя проверка с anon-ключом должна вернуть
`permission denied for table users`, после чего проверить каталог, загрузку/показ фото и один
админский endpoint. Схему `storage` миграция намеренно не меняет.

## Регламент апгрейда Supabase

- До нагрузочного теста проверить в Billing, что spend cap не заблокирует ручной upgrade.
- На этапе 13 покупать upgrade, если p95 профиля превышает 1 секунду или появляются любые
  ошибки подключения к БД.
- После релиза покупать upgrade при доле `5xx > 1%` либо ошибках пула в логах.
- Апгрейд выполнять только в паузе между волнами рассылки: рестарт БД даёт примерно две
  минуты недоступности. До триггера остаёмся на Micro.
- PITR и смена региона БД не входят в этап 12 и рассматриваются после релиза.

## Токены

- `backend/.dev.vars` (гитигнорен) хранит два Cloudflare API-токена:
  - `CLOUDFLARE_API_TOKEN` — с TTL, создавался для ручных операций в конкретной сессии (деплой backend, правка настроек Pages-проекта).
  - `CI_CLOUDFLARE_API_TOKEN` — бессрочный; GitHub Actions не используется, токен сейчас нигде не подключён — держится про запас.
  - Оба — права только `Workers Scripts: Edit` + `Cloudflare Pages: Edit`, аккаунт `saidashev.kirill2004@gmail.com`.
