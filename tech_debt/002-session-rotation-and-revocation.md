# TD-002 — Атомарные сессии и полноценный отзыв credentials

**Приоритет:** P0  
**Этап:** 1  
**Оценка:** M суммарно, поставлять тремя независимыми milestones.  
**Зависимости:** security cutoff не зависит от TD-001; rotation согласовать с TD-001.

## Проблема и доказательства

Ротация opaque session выполняет INSERT replacement (`backend/src/repos/sessions.ts:62-70`), а затем отдельный compare-and-set UPDATE исходной сессии (`:71-80`) без транзакции. Два конкурентных request могут создать два replacement rows; только один будет связан и возвращён, второй останется активным недоступным мусором до expiry.

Каждый authenticated request также пишет `last_seen_at` в session и user (`:81-85`). Это минимум две DB writes на чтение каталога/профиля, что увеличивает latency и write load без пользовательской отдачи.

Наконец, `logout-all`/admin revoke удаляют текущие session rows, но подписанный Mini App `initData` принимается повторно до 24 часов (`backend/src/lib/telegram.ts:6-10, 70-89`; login `backend/src/routes/auth.ts:17-23`). Захваченный proof может немедленно выпустить новую семидневную session после incident-response revoke. Widget proof уже одноразовый; Mini App proof — нет.

## Цель

- Ротация одной session атомарна и оставляет ровно один replacement.
- Activity writes throttled и не выполняются на каждый read.
- `logout-all`, admin revoke и delete блокируют повторный exchange старого Telegram proof.
- Fresh Telegram launch остаётся рабочим; ordinary single-device UX не ломается.

## Не входит

- OAuth/Supabase Auth migration.
- Хранение session token в browser JS.
- Глобальный blacklist каждого initData hash без bounded retention.

## Milestones и отдельный DoD

### A — P0/S: credential cutoff без ожидания TD-001

Добавить `auth_not_before`/эквивалентный epoch; `logout-all`, admin revoke и delete повышают его атомарно с revoke. Telegram exchange сравнивает `auth_date` с epoch с явно протестированным seconds/clock-skew правилом. DoD: captured initData после revoke = 401, fresh launch = 200, raw proof не хранится/логируется.

### B — P0/M: атомарная rotation после согласования DB scope

1. **Red:** добавить isolated Postgres tests для двух concurrent `findSessionAuthUser()` после rotation threshold. Ожидание: один replacement, один возвращённый rotated token, нет второго активного orphan.
2. Перенести rotation INSERT + CAS/link в одну transaction. Варианты loser должны удалить/не создавать replacement, а затем прочитать winner state без раскрытия winner token.
3. DoD: concurrency test оставляет ровно один linked active replacement; loser не раскрывает winner token; UI корректно принимает rotated cookie.

### C — P1/S: activity write throttle

Добавить conditional `last_seen_at` update не чаще измеренно достаточного retention cadence; user activity не писать на каждый authenticated GET. DoD: тесты decision boundary и измеренное уменьшение writes без поломки retention/admin activity UX.

## Критерии приёмки

- Concurrent rotation не создаёт незакреплённые активные session rows.
- Каждый milestone может быть выпущен/откачен отдельно; performance milestone не блокирует security fixes.
- Logout-all/admin revoke/delete запрещают старый initData exchange.
- Fresh launch и Widget exchange продолжают работать.
- Session TTL/grace/rotation constants имеют decision-table tests.
- Audit event фиксирует admin revoke и результат.

## Проверка

```sh
bun test backend/tests/telegram.test.ts backend/tests/appSecurity.test.ts
bun run test:integration
bun run typecheck
bun run build
```

Ручной smoke: Mini App login, параллельные запросы на rotation boundary, logout-all, повторное открытие свежего Mini App.

## Ловушки и rollout

- Сравнение `auth_date <= auth_not_before` должно учитывать granularity, иначе fresh launch в ту же секунду может быть отклонён. Зафиксировать правило тестом.
- Не логировать raw initData, session token/hash или Telegram proof.
- Schema migration должна быть additive и иметь безопасный default для существующих users.
- Rollout: backend понимает старые rows → миграция → backend deploy → smoke → только затем UI-message polish.

## Вероятные файлы

`database/migrations/`, `packages/contracts/src/auth.ts`, `backend/src/repos/sessions.ts`, `backend/src/routes/auth.ts`, `backend/src/lib/telegram.ts`, `backend/src/routes/admin/users.ts`, session/integration tests, auth UI.
