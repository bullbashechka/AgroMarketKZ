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

`telegram-web-app.js` подключается в `index.html` — даёт `window.Telegram.WebApp` и `initData`.

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
2. **Браузер** — без сессии показывается `LoginScreen` с Telegram Login Widget (`POST /auth/widget`).
3. **Жёсткая стена регистрации** — пока `profile.isRegistered === false`, виден только `RegisterScreen` (имя предзаполнено из Telegram; телефон — нативный «Поделиться контактом» в Telegram или ручной ввод, строго казахстанский мобильный).
4. После регистрации — главное меню (`HomePlaceholder`).

> Полноценный 3-вкладочный каркас (TanStack Router) и формы (TanStack Form) появятся в Этапе 5/6 поверх готового `AuthProvider`.
