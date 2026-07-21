# webapp

Telegram Mini App на **React + Vite**, серверное состояние — **TanStack Query**. Работает внутри Telegram и как обычное веб-приложение в браузере.

## Запуск

```sh
bun run dev          # Vite, http://localhost:5173 (--host для доступа из туннеля)
bun run typecheck
bun run build
```

Переменные (`.env`, см. [.env.example](./.env.example)):

| Переменная | Назначение |
|-----------|-----------|
| `VITE_API_URL` | базовый URL backend |
| `VITE_TELEGRAM_BOT_USERNAME` | username бота (без `@`) для Login Widget в браузере |
| `SUPABASE_URL` | не `VITE_`-переменная — читается только `scripts/generate-headers.ts` при сборке, в клиентский бандл не попадает |

`telegram-web-app.js` подключается в `index.html` — даёт `window.Telegram.WebApp` и `initData`.

## Security headers / CSP

`bun run build` после `vite build` запускает `scripts/generate-headers.ts`, который пишет `dist/_headers` (Cloudflare Pages) с CSP и остальными security-заголовками. `connect-src`/`img-src` содержат точные origin API и Supabase — берутся из `VITE_API_URL`/`SUPABASE_URL` на момент сборки, поэтому оба обязательны: без них (или с пустым значением, как в режиме dev-туннеля с proxy — см. ниже) сборка падает с ненулевым кодом и `dist/_headers` не публикуется.

CSP по умолчанию `Content-Security-Policy-Report-Only` — переключить на enforcing (`Content-Security-Policy`) можно переменной `CSP_ENFORCE=1` при сборке, но только после ручной проверки в задеплоенном Telegram Web/Mini App, Login Widget, PhotoSwipe и прямой загрузки изображений. `X-Frame-Options` намеренно не добавляется — сломает Telegram Web.

## Структура

```
src/
  main.tsx                 # провайдеры: QueryClientProvider → AuthProvider → App
  App.tsx                  # гейт: loading → needsLogin → register → home
  lib/
    auth.tsx               # AuthProvider/useAuth: bootstrap сессии, login, register
    api.ts                 # fetch-обёртка (Bearer, обработка 401), ApiError
    token.ts               # JWT в localStorage
    telegram.ts            # initData, контекст Telegram, requestContact
  screens/
    LoginScreen.tsx        # Telegram Login Widget (браузер)
    RegisterScreen.tsx     # имя + телефон (жёсткая стена регистрации)
    HomePlaceholder.tsx    # заглушка главного меню (вкладки — Этап 5/6)
```

## Поток авторизации (Этап 3)

1. **Telegram** — `App` молча логинится по `initData` (`POST /auth/telegram`), JWT сохраняется в `localStorage`. Повторного входа пользователь не видит.
2. **Браузер** — без сессии показывается `LoginScreen` с Telegram Login Widget (`POST /auth/widget`). Виджет использует `data-auth-url` (redirect с данными в query string), а не `data-onauth` (JS-колбэк через `eval()`, несовместимый с CSP `script-src` без `unsafe-eval`) — см. `LoginScreen.tsx`.
3. **Жёсткая стена регистрации** — пока `profile.isRegistered === false`, виден только `RegisterScreen` (имя предзаполнено из Telegram; телефон — нативный «Поделиться контактом» в Telegram или ручной ввод, строго казахстанский мобильный).
4. После регистрации — главное меню (`HomePlaceholder`).

> Полноценный 3-вкладочный каркас (TanStack Router) и формы (TanStack Form) появятся в Этапе 5/6 поверх готового `AuthProvider`.
