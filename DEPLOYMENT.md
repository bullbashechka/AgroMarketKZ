# Деплой

## Текущий статус

- **Backend (Cloudflare Workers):** `https://agromarketkz-backend.bullbashechka.workers.dev`
- **Webapp (Cloudflare Pages):** `https://agromarketkz-webapp.pages.dev`
- **Telegram-вебхук** переключён на прод-backend.
- Прод-секреты (`JWT_SECRET`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `ADMIN_ALLOWLIST`, `DATABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`) заданы через `wrangler secret put`.
- **GitHub Actions отключён** (`repos/.../actions/permissions: enabled=false`) — на аккаунте не прошёл платёж, разбираться не стали. Workflow-файл (`.github/workflows/ci.yml`, джобы `verify` + `deploy`) остался в репозитории нетронутым — можно включить обратно в любой момент (`gh api -X PUT repos/bullbashechka/AgroMarketKZ/actions/permissions -F enabled=true`) после починки биллинга, автодеплой на пуш в `main` заработает сам.

## Осталось сделать вручную (BotFather)

Через переписку с @BotFather в Telegram — я туда доступа не имею:

1. **Bot Settings → Menu Button** → URL `https://agromarketkz-webapp.pages.dev`
2. **`/setdomain`** → `agromarketkz-webapp.pages.dev` (иначе Login Widget в браузере не работает)

## Проверки перед деплоем (раз CI отключён — делать руками)

```bash
bun run typecheck                 # типы во всех воркспейсах
cd backend && bun test && cd ..   # юнит-тесты backend
bun run build                     # прод-сборка (нужны VITE_API_URL и SUPABASE_URL в env)
```

Если всё зелёное — деплой.

## Деплой backend

```bash
cd backend
export CLOUDFLARE_API_TOKEN=$(grep '^CLOUDFLARE_API_TOKEN=' .dev.vars | cut -d= -f2-)
./node_modules/.bin/wrangler deploy
```

## Деплой webapp

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

## Токены

- `backend/.dev.vars` (гитигнорен) хранит два Cloudflare API-токена:
  - `CLOUDFLARE_API_TOKEN` — с TTL, создавался для ручных операций в конкретной сессии.
  - `CI_CLOUDFLARE_API_TOKEN` — бессрочный, лежит и в GitHub Secrets (`CLOUDFLARE_API_TOKEN`) для отключённого пока автодеплоя.
  - Оба — права только `Workers Scripts: Edit` + `Cloudflare Pages: Edit`, аккаунт `saidashev.kirill2004@gmail.com`.
