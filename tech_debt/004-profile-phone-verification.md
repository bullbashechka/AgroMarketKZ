# TD-004 — Верификация телефона при редактировании профиля

**Приоритет:** P1  
**Этап:** 1  
**Оценка:** S  
**Тип:** подтверждённый функциональный дефект.

## Проблема

`ContactFields` получает подписанный Telegram contact response, но оставляет только phone (`webapp/src/components/ContactFields.tsx:18-21`). `ProfileEditScreen` отправляет только `{ contactName, contactPhone }` (`webapp/src/screens/ProfileEditScreen.tsx:23-35`). `PUT /profile` не вызывает Telegram proof validation (`backend/src/routes/profile.ts:58-63`), а `updateContacts()` меняет только отображаемые контакты (`backend/src/repos/users.ts:155-169`).

В результате кнопка «Поделиться контактом» визуально заполняет номер, но после сохранения новый номер не становится verified. Для пользователя это скрытая потеря результата нативного действия.

## Цель

- Signed contact proof проходит от native Telegram action до backend boundary.
- Номер помечается verified только если proof валиден, принадлежит текущему Telegram user и совпадает с нормализованным номером.
- Ручная правка номера после share немедленно инвалидирует локальный proof.
- Browser/non-Telegram edit остаётся разрешённым, но unverified.

## TDD-план

1. **Red contract tests:** расширить `updateProfileInput` optional `contactResponse`; проверить valid/absent/malformed shape и отсутствие proof в response DTO/logs.
2. **Red UI pure test:** state transition `shared proof → phone edit` очищает proof; name edit не очищает.
3. Обновить `ContactFields`: явный `onContactResponseChange`; при share передать phone + proof, при ручном phone change передать `undefined`.
4. `ProfileEditScreen` хранит proof и включает его в parse/mutation input. Тот же behavior проверить у других экранов, где shared contact должен подтверждать номер; не размножать отдельные правила.
5. Backend `PUT /profile` вызывает `tryValidateContactPhoneForUser`, передаёт verified phone в repository.
6. `updateContacts` атомарно обновляет contacts и `verified_phone = new phone` только при совпавшем proof; при смене без proof старое `verified_phone` может остаться как исторический verified номер, но derived `contact_phone = verified_phone` станет false. Зафиксировать продуктовую семантику тестом.
7. E2E/manual: Mini App share, save, reload; manual phone edit; invalid/foreign contact response.

## Критерии приёмки

- Share → save показывает `phoneVerified=true` после reload.
- Ручная правка shared phone → save показывает false.
- Чужой/битый/просроченный proof не подтверждает номер и возвращает actionable 4xx.
- Proof не хранится в localStorage, query cache дольше запроса, audit metadata или логах.
- Request/feedback/registration flows не регрессируют.

## Проверка

```sh
bun test packages/contracts/tests/telegramContact.test.ts backend/tests/telegram.test.ts backend/tests/users.test.ts
bun run test:integration
bun run typecheck
bun run test:e2e
```

Ручная Telegram-проверка обязательна: browser automation не доказывает native `requestContact` подпись.

## Ловушки

- Нельзя считать номер verified только потому, что он пришёл из клиентского callback.
- Нельзя сохранять raw proof для повторного использования.
- Нормализация должна выполняться одинаково до сравнения proof и form phone.
- Ошибка нативного share не должна стирать уже введённый вручную номер.

## Вероятные файлы

`packages/contracts/src/profile.ts`, `webapp/src/components/ContactFields.tsx`, `webapp/src/screens/ProfileEditScreen.tsx`, возможно `FeedbackScreen.tsx`, `backend/src/routes/profile.ts`, `backend/src/repos/users.ts`, tests/E2E.
