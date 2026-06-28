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

Инфраструктура: Docker Compose (локальная PostgreSQL), Cloudflare Pages/Workers (прод), Supabase Pro PostgreSQL + Storage.

## Требования

- [Bun](https://bun.sh) ≥ 1.3
- Docker (для локальной PostgreSQL)
- `psql` (для миграций и сидов)

## Запуск локально

```sh
# 1. Зависимости
bun install

# 2. Переменные окружения
cp .env.example .env          # заполнить значения (см. ниже)

# 3. База данных
docker compose up -d postgres
bun run db:migrate            # применить SQL-миграции
bun run db:seed:dev           # демо-категории и карточки (опционально)

# 4. Dev-серверы (contracts watch + backend + webapp)
bun run dev
```

После старта: backend — http://localhost:3000, webapp — http://localhost:5173, PostgreSQL — порт `5433`.

Отдельно: `bun run dev:backend`, `bun run dev:webapp`.

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
