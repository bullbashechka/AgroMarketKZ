# Деплой

## Текущий статус

- **Backend (Cloudflare Workers):** `https://agromarketkz-backend.bullbashechka.workers.dev`
- **Webapp (Cloudflare Pages):** `https://agromarketkz-webapp.pages.dev`
- **Telegram-вебхук** переключён на прод-backend.
- Прод-секреты (`JWT_SECRET`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `ADMIN_ALLOWLIST`, `DATABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`) заданы через `wrangler secret put`.
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

## Токены

- `backend/.dev.vars` (гитигнорен) хранит два Cloudflare API-токена:
  - `CLOUDFLARE_API_TOKEN` — с TTL, создавался для ручных операций в конкретной сессии (деплой backend, правка настроек Pages-проекта).
  - `CI_CLOUDFLARE_API_TOKEN` — бессрочный; GitHub Actions не используется, токен сейчас нигде не подключён — держится про запас.
  - Оба — права только `Workers Scripts: Edit` + `Cloudflare Pages: Edit`, аккаунт `saidashev.kirill2004@gmail.com`.
