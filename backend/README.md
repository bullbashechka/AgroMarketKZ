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
    jwt.ts          # выпуск/проверка JWT (hono/jwt, HS256, 30 дней)
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

После успешной валидации создаётся/обновляется `User` (зеркало Telegram: id, username, имя — обновляется при каждом входе; контактные имя/телефон неприкосновенны) и выдаётся **JWT на 30 дней** (`Authorization: Bearer`). В Telegram токен молча перевыпускается из свежего `initData`, поэтому повторного входа пользователь не видит.

**Админы** определяются по `ADMIN_ALLOWLIST` (числовые Telegram id, через запятую). Проверка живая на каждом запросе (`requireAdmin`), статус в токен не зашит — выдача/снятие прав мгновенны.

## API

| Метод | Путь | Авторизация | Тело | Ответ |
|-------|------|-------------|------|-------|
| `GET` | `/health` | — | — | `{ status, app }` |
| `POST` | `/auth/telegram` | — | `{ initData }` | `{ token, profile }` |
| `POST` | `/auth/widget` | — | поля Login Widget (`id, first_name, …, hash`) | `{ token, profile }` |
| `GET` | `/profile` | Bearer | — | `Profile` |
| `POST` | `/profile/register` | Bearer | `{ contactName, contactPhone }` | `Profile` |
| `PUT` | `/profile` | Bearer | `{ contactName, contactPhone }` | `Profile` |

`contactPhone` принимается только как казахстанский мобильный (`+7 7xx`), нормализуется к `+77XXXXXXXXX`; иначе `400`. Ошибки — единый JSON `{ error, issues? }` со статусами `400/401/403/404/500`.
