# AgroMarketKZ

Витрина-каталог агротоваров, сельхозтехники и услуг, обёрнутая в **Telegram Mini App** (и работающая как обычное веб-приложение в браузере). Без онлайн-оплат: приложение служит витриной и инструментом сбора заявок и контактов. Язык интерфейса — русский.

Полное описание продукта — в [PRD.md](./PRD.md); разбивка на этапы — в [TASKS.md](./TASKS.md); пользовательские сценарии — в [USER_FLOW.md](./USER_FLOW.md).

## Стек

Монорепо на **Bun** (workspaces):

| Пакет | Технологии | Назначение |
|-------|-----------|------------|
| `backend/` | Hono + Cloudflare Workers + Supabase PostgreSQL + кастомный JWT + Zod | REST API, авторизация, уведомления |
| `webapp/` | React + Vite + TanStack Query | Telegram Mini App (CSR за авторизацией) |
| `packages/contracts/` | Zod + TypeScript | Общие схемы и типы (единый источник правды) |

Инфраструктура: Supabase PostgreSQL (dev + prod) + Storage, Cloudflare Pages/Workers (прод).

## Требования

- [Bun](https://bun.sh) ≥ 1.3
- `psql` (для миграций и сидов)
- Аккаунт Supabase с доступом к проекту (см. `DATABASE_URL` в `.env.example`)

## Запуск локально

```sh
# 1. Зависимости
bun install

# 2. Переменные окружения
cp .env.example .env          # заполнить значения (см. ниже), включая DATABASE_URL от Supabase

# 3. База данных (Supabase, миграции применяются один раз на проект)
bun run db:migrate             # применить SQL-миграции
bun run db:seed:dev            # демо-категории и карточки (опционально)

# 4. Dev-серверы (contracts watch + backend + webapp)
bun run dev
```

После старта: backend — http://localhost:3000, webapp — http://localhost:5173, БД — Supabase (без локального порта).

Отдельно: `bun run dev:backend`, `bun run dev:webapp`.

## Тестирование в Telegram (туннель)

Mini App открывается на телефоне в Telegram — `localhost` оттуда недоступен. Нужен **один** туннель на webapp (порт 5173); backend наружу не выставляем — Vite dev-сервер сам проксирует API-запросы (`/auth`, `/profile`, `/catalog`, `/settings`, `/favorites`, `/requests`, `/feedback`, `/admin`, `/health`) на `localhost:3000` (см. `server.proxy` в [`webapp/vite.config.ts`](./webapp/vite.config.ts)). Благодаря этому запрос к API для браузера остаётся same-origin — второй туннель и правки `CORS`/`WEBAPP_ORIGIN` не нужны.

Второй туннель на backend заводить **не надо**: бесплатный ngrok даёт только один одновременный публичный эндпоинт на аккаунт — второй туннель либо не поднимется, либо будет конфликтовать с первым на одном домене.

```sh
# 1. dev-серверы подняты (bun run dev, либо dev:backend + dev:webapp)

# 2. один туннель на webapp
ngrok http 5173
```

В `.env` при таком (proxy) варианте `VITE_API_URL` должен быть **пустым** (`VITE_API_URL=`) — тогда `fetch` идёт по относительному пути и попадает в прокси. После правки `.env` или `vite.config.ts` webapp dev-сервер нужно перезапустить (переменные и прокси применяются только при старте).

URL туннеля вставляется в BotFather → бот → Bot Settings → Menu Button. На бесплатном ngrok URL может быть закреплён за аккаунтом (не меняется между запусками) — но если всё же сменился, обновить там же.

Если ngrok пишет `ERR_NGROK_3200` («endpoint offline») — агент (`ngrok http ...`) сейчас не запущен, нужно перезапустить командой выше.

Если в самом Mini App при открытии видно `Load failed` / «Повторить» — это провал сетевого запроса на этапе логина (`POST /auth/telegram`), почти всегда из-за того, что `VITE_API_URL` указывает на недоступный с телефона адрес (например, оставшийся `http://localhost:3000`) или webapp dev-сервер не перезапущен после правки `.env`/`vite.config.ts`.

## Переменные окружения

Все переменные — в [.env.example](./.env.example). Ключевые:

| Переменная | Где | Назначение |
|-----------|-----|-----------|
| `DATABASE_URL` | backend | строка подключения PostgreSQL |
| `JWT_SECRET` | backend | подпись JWT сессий |
| `TELEGRAM_BOT_TOKEN` | backend | валидация `initData` и Login Widget |
| `ADMIN_ALLOWLIST` | backend | числовые Telegram id админов (через запятую) |
| `VITE_API_URL` | webapp | базовый URL backend |
| `VITE_TELEGRAM_BOT_USERNAME` | webapp | username бота для Login Widget в браузере |

Локально (Bun) переменные читаются из `.env`; на Cloudflare Workers — из `wrangler.toml [vars]` и секретов (`wrangler secret put`).

## Проверка качества

```sh
bun run typecheck   # типы во всех воркспейсах (contracts собирается первым)
bun test            # юнит-тесты (contracts + backend)
bun run build       # production-сборка всех пакетов
```

## Документация по пакетам

- [backend/README.md](./backend/README.md) — API, модель авторизации, структура.
- [webapp/README.md](./webapp/README.md) — Mini App, поток авторизации.
- [database/README.md](./database/README.md) — БД, миграции, Storage.

## Статус

- [x] Этап 0 — инфраструктура
- [x] Этап 1 — модель данных (Supabase PostgreSQL)
- [x] Этап 2 — общие контракты
- [x] Этап 3 — регистрация и авторизация через Telegram
- [ ] Этап 4+ — API каталога, экраны, админка, деплой (см. [TASKS.md](./TASKS.md))
