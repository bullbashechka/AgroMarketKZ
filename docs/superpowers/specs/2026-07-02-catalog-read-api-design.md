# Каталог (публичное чтение) — дизайн API

Дата: 2026-07-02. Этап 4 (TASKS.md): «Каталог (публичное чтение)».

## Контекст

Первая открытая задача Этапа 4 — три read-точки каталога для Telegram Mini App
AgroMarketKZ: список категорий вкладки, список карточек с фильтрами и поиском,
карточка по id. БД (`database/migrations/0001_initial_schema.sql`) и Zod-контракты
(`packages/contracts`) уже готовы; нужен только backend-слой (Hono + postgres.js).

## Продуктовые решения

Обсуждены и утверждены с владельцем продукта:

1. **Доступ.** Каталог виден только зарегистрированным пользователям (JWT +
   заполненные имя/телефон). API закрыт от парсеров — доступ невозможен без
   прохождения Telegram-авторизации и регистрации.
2. **Пустые категории.** Список категорий отдаёт все активные категории вкладки,
   включая те, где ещё нет карточек. Пустое состояние отрисовывает фронт
   («пока пусто — оставьте заявку»), не backend.
3. **Снятая с публикации карточка.** Карточка по прямому `id` отдаётся даже в
   архиве (`archivedAt` заполнен) — фронт показывает заглушку «объявление снято
   с публикации» + кнопку «Оставить заявку», чтобы не терять контакт с уже
   заинтересованным пользователем (например, из избранного). В списках
   каталога и в поиске архивные карточки не участвуют.
4. **Поиск.** По части названия карточки, без учёта регистра (`ilike '%…%'`),
   без исправления опечаток (fuzzy-поиск можно добавить позже отдельной
   задачей, не блокирует MVP).
5. **Порядок карточек.** Управляется администратором через `sort_order`
   (следующий тай-брейк — `title`), как витрина маркетплейса: важное/выгодное
   можно закрепить сверху. Совпадает с существующим индексом
   `cards_active_catalog_idx`.
6. **Пагинация и цена.** Load-more через `limit/offset` (уже есть в
   `paginationQuerySchema`/`paginated()`), цена — целое число тенге.

## API

Все три маршрута смонтированы под `/catalog` и защищены цепочкой
`requireAuth → requireRegistered`.

| Метод | Путь | Вход | Ответ |
|---|---|---|---|
| GET | `/catalog/categories?type=` | `categoryListQuery` | `categoryListResponse` |
| GET | `/catalog/cards?type=&categoryId?&search?&priceType?&limit?&offset?` | `cardListQuery` | `cardListResponse` (`items`, `hasMore`, `nextOffset`) |
| GET | `/catalog/cards/:id` | uuid в пути | `cardDetailSchema` (включая архивные) |

Все фильтры карточек комбинируются по И. Невалидный `uuid` в пути или
несуществующая карточка → `404`. Запрос без токена → `401`. Токен валиден, но
пользователь не завершил регистрацию → `403`.

## Реализация

- `backend/src/lib/pagination.ts` — `paginateRows(rows, limit, offset)`: чистая
  функция, превращающая `limit+1` строк в `{items, hasMore, nextOffset}`.
- `backend/src/lib/search.ts` — `escapeLike(value)`: экранирование `%`, `_`,
  `\` в пользовательском вводе поиска перед `ilike`.
- `backend/src/lib/storage.ts` — `publicImageUrl(env, storagePath)`: сборка
  публичного URL фото из Supabase Storage (бакет `card-images` публичный, см.
  `database/supabase/storage.sql`; в БД хранится только `storage_path`).
- `backend/src/middleware/registered.ts` — `requireRegistered`: ставится
  после `requireAuth`, проверяет `users.registered_at is not null` по БД
  (JWT выдаётся до регистрации, поэтому статус нельзя закодировать в токене).
- `backend/src/repos/catalog.ts` — SQL-запросы (`listCategories`, `listCards`,
  `getCardById`) и pure-мапперы БД-строк в DTO (`toCategory`,
  `toCardListItem`, `toCardDetail`). Превью карточки в списке получает первое
  фото и первую характеристику через `left join lateral … order by sort_order
  limit 1`.
- `backend/src/routes/catalog.ts` — три GET-маршрута, парсинг query/params
  через Zod-схемы контрактов, подключены в `backend/src/app.ts` как
  `app.route("/catalog", catalogRoutes)`.
- `backend/src/env.ts` — добавлены `SUPABASE_URL`, `SUPABASE_STORAGE_BUCKET`
  (уже присутствуют в `.dev.vars.example` и корневом `.env.example`).

## Тесты

Юнит-тесты (bun:test) на всю чистую логику — по образцу существующих
`admin.test.ts`/`jwt.test.ts`/`telegram.test.ts`, которые тоже не трогают БД:

- `tests/pagination.test.ts` — `paginateRows` (меньше/ровно/больше limit,
  ненулевой offset, пустой список).
- `tests/search.test.ts` — `escapeLike` (`%`, `_`, `\`, комбинации, пустая
  строка).
- `tests/storage.test.ts` — `publicImageUrl` (базовый путь, лишние слэши по
  обеим сторонам).
- `tests/catalog.test.ts` — мапперы `toCategory`/`toCardListItem`/
  `toCardDetail` (цена fixed/on_request, `shortSpec` есть/нет,
  `imageUrl` есть/нет, `archivedAt` есть/нет, пустые галерея/характеристики).

SQL-запросы и middleware, завязанные на реальное соединение с БД, в этом
репозитории не покрываются unit-тестами (как и существующие `repos/users.ts`,
`middleware/auth.ts`) — проверяются вручную через dev-сервер (см. план).
