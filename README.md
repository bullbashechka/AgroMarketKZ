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

### Альтернатива: Cloudflare Tunnel (`cloudflared`)

Не требует аккаунта ngrok и не ограничен одним эндпоинтом. Домен `*.trycloudflare.com` уже разрешён в `allowedHosts` ([`webapp/vite.config.ts`](./webapp/vite.config.ts)) — правок не нужно.

```sh
brew install cloudflared    # один раз, если ещё не установлен

# 1. dev-серверы подняты (bun run dev, либо dev:backend + dev:webapp)

# 2. один туннель на webapp (quick tunnel, без аккаунта Cloudflare)
cloudflared tunnel --url http://localhost:5173
```

В логе появится случайный URL вида `https://<три-случайных-слова>.trycloudflare.com` — его и вставляем в BotFather → бот → Bot Settings → Menu Button. В отличие от ngrok, при каждом перезапуске `cloudflared` домен **меняется** — обновлять Menu Button нужно каждый раз заново. `VITE_API_URL` при этом варианте так же должен быть пустым (`VITE_API_URL=`).

Если нужен стабильный (не меняющийся) домен — это именованный туннель с привязкой к своему домену в Cloudflare (`cloudflared tunnel create ...` + `cloudflared tunnel route dns ...`), что требует зоны в Cloudflare; для локальной разработки обычно достаточно quick tunnel.

Если в самом Mini App при открытии видно `Load failed` / «Повторить» — это провал сетевого запроса на этапе логина (`POST /auth/telegram`), почти всегда из-за того, что `VITE_API_URL` указывает на недоступный с телефона адрес (например, оставшийся `http://localhost:3000`) или webapp dev-сервер не перезапущен после правки `.env`/`vite.config.ts`.

## Telegram-бот и вебхук (Этап 8)

Бот делает три вещи: отвечает в личке приветствием с кнопкой запуска Mini App,
сам подключает группу для уведомлений о заявках (когда его добавляет админ)
и служит адресатом «Поделиться контактом» (верификация телефона).

### Настройка dev-бота в BotFather (один раз)

1. `/newbot` — создать тестового бота, токен → `TELEGRAM_BOT_TOKEN`, username (без @) → `TELEGRAM_BOT_USERNAME` и `VITE_TELEGRAM_BOT_USERNAME`.
2. `/newapp` — создать Mini App у бота: URL — адрес туннеля, short name → `TELEGRAM_MINIAPP_SHORTNAME` (нужен для deep-link-кнопок «Открыть заявку» в уведомлениях).
3. Bot Settings → Menu Button — URL туннеля (кнопка меню в личке).
4. `/setdomain` — домен туннеля (для Login Widget в браузере). Виджет реально перенаправляет браузер на этот домен после входа (`data-auth-url`), поэтому при смене адреса туннеля `/setdomain` нужно обновлять так же, как Menu Button выше.
5. Bot Settings → Allow Groups? — **включить** (иначе бота нельзя добавить в группу уведомлений).
6. Сгенерировать случайную строку через CSPRNG (например `openssl rand -hex 32`), НЕ придумывать вручную — эндпоинт `/telegram/webhook` не ограничен по частоте запросов, и стойкость к перебору держится только на энтропии этого секрета → `TELEGRAM_WEBHOOK_SECRET`.

Прод-бот настраивается так же на Этапе 10, на прод-домен.

### Вебхук

```sh
# после поднятия dev-серверов и туннеля (URL туннеля webapp — vite проксирует /telegram на backend):
bun run --cwd backend webhook:set https://<tunnel>

# проверить/удалить:
bun run --cwd backend webhook:set --delete
```

После **каждой смены URL туннеля** запускать `webhook:set` заново (и обновлять
Menu Button + `/newapp` URL в BotFather). В выводе скрипта `getWebhookInfo` не
должно быть `last_error_message`.

### Подключение чата уведомлений

Добавить бота в группу аккаунтом из `ADMIN_ALLOWLIST` — бот сохранит чат и
ответит «Уведомления подключены». Удаление бота из группы отключает уведомления.
Запасной вариант — вручную указать chat id в админке (Управление → Настройки).

## Переменные окружения

Все переменные — в [.env.example](./.env.example). Ключевые:

| Переменная | Где | Назначение |
|-----------|-----|-----------|
| `DATABASE_URL` | backend | строка подключения PostgreSQL |
| `JWT_SECRET` | backend | подпись JWT сессий |
| `TELEGRAM_BOT_TOKEN` | backend | валидация `initData`, Login Widget, отправка уведомлений |
| `TELEGRAM_WEBHOOK_SECRET` | backend | секрет вебхука бота (проверка `X-Telegram-Bot-Api-Secret-Token`) |
| `TELEGRAM_BOT_USERNAME` | backend | username бота без @ — deep-link-кнопки в уведомлениях |
| `TELEGRAM_MINIAPP_SHORTNAME` | backend | short name Mini App из `/newapp` — вторая часть deep-link |
| `ADMIN_ALLOWLIST` | backend | числовые Telegram id админов (через запятую) |
| `VITE_API_URL` | webapp | базовый URL backend |
| `VITE_TELEGRAM_BOT_USERNAME` | webapp | username бота для Login Widget в браузере |

Локально (Bun) переменные читаются из `.env`; на Cloudflare Workers — из `wrangler.toml [vars]` и секретов (`wrangler secret put`).

## Деплой

Backend и webapp развёрнуты на Cloudflare (Workers + Pages), Telegram-вебхук переключён на прод. Webapp автодеплоится на пуш через Git-интеграцию Cloudflare Pages (GitHub Actions не используется); backend деплоится вручную. Актуальные URL и шаги — в [DEPLOYMENT.md](./DEPLOYMENT.md).

## Проверка качества

```sh
bun run typecheck   # типы во всех воркспейсах (contracts собирается первым)
bun test            # юнит-тесты (contracts + backend)
bun run test:e2e    # Playwright-сценарии; нужны настроенные .env, .env.e2e (cp .env.e2e.example .env.e2e) и dev Supabase
bun run build       # production-сборка всех пакетов
```

## Документация по пакетам

- [backend/README.md](./backend/README.md) — API, модель авторизации, структура.
- [webapp/README.md](./webapp/README.md) — Mini App, поток авторизации.
- [database/README.md](./database/README.md) — БД, миграции, Storage.
- [DEPLOYMENT.md](./DEPLOYMENT.md) — статус продакшна, токены, команды ручного деплоя.

## Статус

- [x] Этап 0 — инфраструктура
- [x] Этап 1 — модель данных (Supabase PostgreSQL)
- [x] Этап 2 — общие контракты
- [x] Этап 3 — регистрация и авторизация через Telegram
- [x] Этап 4 — API каталога, заявок, профиля и администрирования
- [x] Этапы 5–6 — каталог, личный раздел и отложенная регистрация
- [x] Этап 7 — админ-панель
- [x] Этап 8 — Telegram-бот, верификация контакта и уведомления
- [x] Этап 9 и 9.1 — E2E-покрытие и UX-аудит
- [x] Этап 10 — production-деплой (Cloudflare Workers/Pages, прод-бот, секреты) — см. [DEPLOYMENT.md](./DEPLOYMENT.md); осталась ручная настройка Menu Button/`/setdomain` на прод-домен в BotFather
- [ ] Этап 11 — реальные контакты вместо плейсхолдеров и наполнение каталога

Текущий план запуска и оставшиеся задачи описаны в [TASKS.md](./TASKS.md).
