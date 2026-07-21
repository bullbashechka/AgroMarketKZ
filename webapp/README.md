# webapp

Telegram Mini App на **React + Vite**. Работает внутри Telegram и в обычном браузере. TanStack Query управляет серверным состоянием, TanStack Router — экранной навигацией, TanStack Form — формами.

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
| `SUPABASE_URL` | не `VITE_`-переменная: скрипт сборки читает её для CSP, в клиентский бандл она не попадает |

`telegram-web-app.js` подключается в `index.html` и даёт `window.Telegram.WebApp` с `initData`.

## Security headers / CSP

После `vite build` команда `bun run build` запускает `scripts/generate-headers.ts`. Скрипт создаёт `dist/_headers` для Cloudflare Pages с CSP и остальными security-заголовками. Он добавляет точные origin API и Supabase в `connect-src` и `img-src`, поэтому production-сборке нужны `VITE_API_URL` и `SUPABASE_URL`. В режиме локального туннеля с Vite proxy эти значения могут быть пустыми, но production-сборку с ними запускать нельзя.

CSP по умолчанию использует `Content-Security-Policy-Report-Only`. Включайте enforcing-режим через `CSP_ENFORCE=1` только после проверки в Telegram, Login Widget, PhotoSwipe и прямой загрузки изображений. `X-Frame-Options` не добавляется, поскольку Telegram Web не сможет открыть Mini App.

## Устройство приложения

```
src/
  main.tsx                 # Telegram-тема, deep links, QueryClient и провайдеры
  router.tsx               # маршруты каталога, личного и админ-раздела
  components/              # общие элементы каталога, шторки, формы и AppShell
  components/admin/        # элементы админ-панели
  lib/
    auth.tsx               # bootstrap сессии, вход, регистрация и профиль
    api.ts                 # fetch-обёртка, Bearer JWT и ApiError
    registrationIntent.tsx # продолжение действия после регистрации
    shareContact.ts        # Telegram requestContact и серверная проверка подписи
    startParam.ts          # переход к заявке из startapp deep link
    telegram.ts            # initData, тема, BackButton и нативные возможности
  screens/                 # каталог, карточки, профиль, избранное, обратная связь
  screens/admin/           # карточки, категории, заявки, пользователи и настройки
  styles/                  # токены, базовые стили и компоненты
```

## Вход и регистрация

1. В Telegram приложение отправляет `initData` на `POST /auth/telegram` и сохраняет JWT в `localStorage`.
2. В браузере `LoginScreen` показывает Telegram Login Widget. Виджет использует redirect `data-auth-url`; CSP не разрешает его устаревший JS-колбэк.
3. После подтверждения Telegram-личности каталог доступен без телефона. Регистрация открывается перед избранным, личными разделами и прямой связью.
4. Первая заявка принимает имя и телефон, создаёт профиль в той же операции и возвращает пользователя к успешной отправке. В Telegram можно заполнить и подтвердить телефон через `requestContact`; ручной ввод остаётся запасным вариантом.

## Пользовательские разделы

- «Услуги» и «Товары»: категории, поиск, фильтр цены, карточки и общая заявка.
- Карточка: галерея, цена, характеристики, избранное и шторка связи.
- «Общее»: контакты пользователя, избранное, обратная связь и общая заявка.
- Админы из `ADMIN_ALLOWLIST` получают раздел «Управление»: категории, карточки и их публикация, заявки, пользователи и контакты площадки.

Нижняя панель помнит последний экран каждой вкладки. Повторное нажатие на активную вкладку возвращает к её корню. Клиент обрабатывает Telegram BackButton, системную тему, клавиатуру и `startapp` deep link.
