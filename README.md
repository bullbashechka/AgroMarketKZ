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

Бот делает три вещи: после `/start` отправляет в личку приветственный баннер с краткой инструкцией и кнопкой запуска Mini App,
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
| `PAGES_PROXY_SECRET` | backend + Pages Function | 32+ символов, разрешает только same-origin proxy к Worker |
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
bun test backend packages/contracts webapp # юнит-тесты без Playwright-спеков
bun run test:integration # временный локальный PostgreSQL: create → update → publish
bun run test:e2e    # Playwright; нужны изолированные E2E_* DB/Storage/Telegram/JWT из .env.e2e
bun run build       # production-сборка всех пакетов
```

Каждый E2E-прогон использует уникальный префикс `[e2e:<run-id>]` и отдельные синтетические
Telegram id; автоматическая зачистка карточек, категорий, заявок, feedback, Storage и тестовых
профилей затрагивает только его и не скрывает ошибки.
Загрузки E2E получают отдельный путь `e2e/<run-id>/`; teardown перечисляет этот префикс и
удаляет также файлы, которые не успели привязаться к карточке.
Storage удаляется до SQL-зачистки: при временном сбое карточки и ссылки сохраняются для
повторного teardown, а не превращаются в необратимые orphan-объекты.
Остатки старых прогонов не удаляются wildcard-ом:
после проверки отсутствия активного прогона их можно убрать вручную по конкретному префиксу.
Для удалённых E2E-БД/Supabase нужен корневой `.env` как production baseline; полностью локальная
конфигурация может запускаться без него.

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

## Доработка каталога: территории и предложения

Миграция [`0011_territories_and_listing_data.sql`](./database/migrations/0011_territories_and_listing_data.sql) добавляет справочник из 20 территорий, структурированную географию карточек и предложений с вкладок. Она не выполнялась автоматически: в production не запускайте корневой `bun run db:migrate`, потому что он повторяет весь каталог без журнала применённых файлов. Сначала проверьте полный прогон `0001`→latest в безопасной БД, затем примените конкретный SQL-файл через Supabase SQL Editor или `apply_migration`. Миграция переносит однозначные legacy-локации в новые поля и отношения, а неоднозначные значения оставляет без догадок; старые опубликованные карточки с нерешённой географией или недостающими параметрами нужно вручную заполнить перед следующим сохранением или повторной публикацией. Перед production-релизом проверьте такие карточки отдельно, чтобы региональный фильтр не скрывал непроверенные объявления.

Миграция [`0012_card_update_mutations.sql`](./database/migrations/0012_card_update_mutations.sql) добавляет
серверные receipts для идемпотентного PUT карточки и восстановления после потери ответа. Перед
деплоем backend её нужно применить точечно к production БД через SQL Editor/`apply_migration`,
проверить таблицу, RLS и отсутствие grants для `anon`/`authenticated`, и только затем выкатывать
backend: без неё PUT намеренно не считается успешным.

Миграция [`0013_product_catalog_filters.sql`](./database/migrations/0013_product_catalog_filters.sql)
добавляет товарные группы, объём в тоннах, признак товарной категории и фильтры каталога. Она
скрывает активные товары до ручного backfill и очищает `availability` у всех товаров, сохраняя
карточки, заявки и избранное. Применяйте её в production только точечно через Supabase SQL
Editor/`apply_migration`; после применения проверьте, что у товаров нет `availability` и видимых
товаров, затем заполните поля и опубликуйте их вручную. В текущей доработке production SQL и
деплой не выполнялись.

Текущий план запуска и оставшиеся задачи описаны в [TASKS.md](./TASKS.md).
