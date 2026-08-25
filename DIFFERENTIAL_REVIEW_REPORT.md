# Differential Security Review — Cloudflare PostgreSQL reconnect

## Remediation Update — 2026-08-25

**Status:** ✅ HIGH finding resolved.  
**Current recommendation:** APPROVE для локального merge; перед production rollout нужен live Worker/Hyperdrive smoke.

Исправление разделило DB capabilities:

- обычный `getDb()` восстанавливает client после connection error, но пробрасывает ошибку без скрытого повтора SQL;
- `getIdempotentDb()` разрешает максимум один retry только после явного opt-in;
- explicit capability используется в трёх проверенных maintenance-путях: auth-proof cleanup без наблюдаемого row count, read-only outbox reconciliation и идемпотентная privacy retention;
- session, audit, upload, admin, request и queue mutations остаются на безопасном default;
- code-less transaction callback не повторяется.

Regression validation: `backend/tests/db.test.ts` — 10 pass; все backend tests — 192 pass, 17 integration skip; backend typecheck, production build/Wrangler dry-run и `git diff --check` прошли. Исходный finding ниже сохранён как историческое обоснование исправления; его `REJECT`-вердикт больше не является текущим.

**Дата:** 2026-08-25  
**Scope:** текущая рабочая копия относительно `HEAD 93d002df6174fcc893d49b8dcfa5fddeabd924d1`  
**Стратегия:** SURGICAL — 242 исходных файла в репозитории; полный разбор двух изменённых runtime/test-файлов, их security-critical DB-пути и поверхностная проверка 29 новых Markdown-файлов  
**Состояние scope:** 31 файл до создания этого отчёта; tracked diff `+67/-7`, untracked Markdown `+1045`

## 1. Original Executive Summary

| Severity | Count |
|---|---:|
| 🔴 CRITICAL | 0 |
| 🟠 HIGH | 1 resolved |
| 🟡 MEDIUM | 0 |
| 🟢 LOW | 0 |

**Original Risk:** HIGH  
**Original Recommendation:** REJECT до ограничения прозрачного retry безопасными операциями. Выполнено в remediation update выше.

**Key Metrics:**

- Изменённых runtime-файлов: 1.
- Изменённых test-файлов: 1.
- Прямых вызовов `getDb()` в production-коде: 59 в 16 consumer-модулях.
- Security regression/red flag: общий retry теперь принимает новую code-less категорию ошибки по stack fingerprint.
- Тестовый пробел: новый положительный retry-тест использует только `select 1`; mutation и code-less transaction boundary не проверены.
- Секреты: эвристический scan новых Markdown-файлов не нашёл токены, private keys, credential URLs или присваивания известных secret-переменных.

## 2. What Changed

**Commit Range:** `HEAD..working-tree`  
**Commits:** 0; изменения не закоммичены.  
**Timeline:** 2026-08-25.

| File / group | +Lines | -Lines | Risk | Blast Radius |
|---|---:|---:|---|---|
| `backend/src/db.ts` | 23 | 3 | HIGH | CRITICAL — 59 прямых `getDb()` consumers |
| `backend/tests/db.test.ts` | 44 | 4 | MEDIUM | DB retry contract |
| `docs/`, `errors/`, `tech_debt/` (29 Markdown-файлов) | 1045 | 0 | LOW | Документация/операционные артефакты |

Изменение добавляет четыре stack-frame маркера (`EventEmitter.write → nextWrite → cachedError → new Query`) и считает совпадающую ошибку без `error.code` ошибкой соединения. Существующий `withReconnect()` после такой классификации пересоздаёт клиент и повторяет любой standalone tagged-template SQL один раз. Для транзакций клиент пересоздаётся, но callback повторно не запускается.

Production-артефакт `errors/scheduled-maintenance-failed-dd3a5746.md` содержит именно эту цепочку. Исходники `postgres.js 3.4.9` подтверждают, что `nextWrite()` вызывает `socket.write()`, а driver дописывает Query-origin к stack. Dry-run Worker bundle сохраняет все четыре имени.

## 3. Original High Finding — Resolved

### 🟠 HIGH: Stack fingerprint включает небезопасные standalone writes в прозрачный retry

**Resolution:** ✅ `getDb()` больше не повторяет standalone SQL; retry вынесен в explicit `getIdempotentDb()`.

**File:** `backend/src/db.ts:53` и `backend/src/db.ts:129`  
**Commit:** working tree поверх `93d002d`  
**Blast Radius:** 59 прямых `getDb()` вызовов в 16 consumer-модулях — CRITICAL  
**Test Coverage:** PARTIAL

**Описание**

Новый fallback возвращает `true` только по четырём подстрокам stack. После этого общий proxy не различает чтение, идемпотентную mutation и небезопасный standalone write: любой tagged-template запрос повторяется на новом клиенте.

Наблюдаемый stack убедительно указывает на сбой внутри `socket.write`, но сам stack не является machine-enforced гарантией «сервер не принял ни одного байта». В production error artifact отсутствуют error type, code и message. Поэтому текущая реализация расширяет общий retry boundary, не доказывая требуемую семантику на месте повторного вызова.

Примеры затронутых mutation-путей:

- `backend/src/repos/sessions.ts:30` — standalone INSERT новой bearer-session;
- `backend/src/repos/adminAudit.ts:15` — standalone INSERT audit event;
- `backend/src/lib/notificationOutbox.ts:34` — claim с `attempts = attempts + 1`;
- `backend/src/repos/uploadClaims.ts:9` — standalone INSERT upload claim;
- `backend/src/repos/adminCatalog.ts:1107` — archive mutation;
- `backend/src/repos/requests.ts:384` — смена статуса заявки.

**Historical Context**

- `45a7bce` (2026-07-23) добавил transparent reconnect/retry для connection-level errors.
- `03fa907` (2026-07-23) запретил retry transaction callback, сохранив retry standalone queries.
- `2d07115` (2026-08-24) сузил классификацию до известных connection/socket codes, чтобы не маскировать ошибки приложения.
- Текущий diff снова расширяет классификацию — теперь на code-less stack signature.
- Новый `tech_debt/001-db-client-lifecycle-and-retries.md:14-20` уже фиксирует этот общий invariant как P0: write нельзя повторять без явной idempotency-гарантии call site.

**Failure / Adversarial Scenario**

**Actor:** обычный пользователь или администратор, вызывающий auth/admin mutation; специальная привилегия для создания сбоя не требуется.  
**Exploitability:** HARD — нужен редкий transport failure или другой error с совпавшей цепочкой stack; прямое управление stack извне не доказано.

1. Запрос доходит до standalone mutation через `getDb()`.
2. Driver отклоняет Promise ошибкой, которую `isConnectionError()` принимает по stack fingerprint.
3. `withReconnect()` без знания SQL-семантики пересоздаёт клиент и повторяет mutation.
4. Если первая попытка была принята сервером, но подтверждение потеряно, повтор может:
   - создать дубликат audit event;
   - вернуть constraint error после уже созданной session/upload claim;
   - изменить outbox attempt/state и задержать уведомление;
   - скрыть неоднозначность результата от owning route/repository.

**Baseline Violation:** retry разрешён глобальным transport-слоем, хотя идемпотентность — свойство конкретной операции. Это расходится с уже документированным P0-инвариантом: «ни один write не ретраится без явной idempotency-гарантии на call site».

**Recommendation**

1. Не разрешать stack fallback автоматически повторять произвольный tagged-template SQL.
2. Сделать retry явным только для read-only или доказанно идемпотентных call sites; для остальных — пересоздать клиент для следующего вызова и вернуть исходную ошибку.
3. Если нужен узкий incident fix до TD-001, ограничить новый путь конкретными maintenance reads/deletes/absolute updates, чья повторяемость доказана тестом и SQL predicate.
4. Добавить regression tests:
   - code-less ошибка на standalone mutation не вызывает второй SQL-вызов без explicit opt-in;
   - code-less ошибка в `.begin()` пересоздаёт client, но callback вызывается ровно один раз;
   - explicit read/idempotent operation получает максимум один retry;
   - negative stack cases: нарушенный порядок, неполная цепочка, те же строки только в message.

## 4. Test Coverage Analysis

| Changed behavior | Coverage | Result |
|---|---|---|
| Известные socket codes | Unit | ✅ |
| Новый Cloudflare stack fingerprint | Unit fixture | ✅ |
| Retry на новом клиенте | Unit, `select 1` | ✅ |
| Транзакция не повторяется | Unit, coded и code-less error after callback | ✅ |
| Новый code-less path на обычной mutation | Unit: reconnect без retry | ✅ |
| Explicit idempotent query | Unit: максимум один retry | ✅ |
| Реальный Worker/Hyperdrive stale-socket incident | Нет live smoke | ❌ |
| Production bundle сохраняет frame names | Wrangler dry-run + artifact grep | ✅ |

`bun test backend/tests` после remediation дал 192 pass, 17 DB integration tests skipped и 0 fail. Unit-tests закрывают retry invariant; skipped integration tests не моделируют настоящий stale Cloudflare socket.

## 5. Blast Radius Analysis

| Symbol | Direct callers / consumers | Risk | Priority |
|---|---:|---|---|
| `isConnectionError()` | 3 call sites (`withReconnect.apply`, `.begin`, Hono error boundary) | HIGH | P1 |
| `withReconnect()` через `getDb()` | 59 вызовов в 16 production consumer-модулях | HIGH | P0 |
| `getDb()` | catalog, sessions, auth proofs, admin audit/catalog, requests, privacy, uploads, outbox, Telegram updates и др. | HIGH | P0 |

Hono error boundary дополнительно меняет внешний ответ: совпавшая ошибка возвращается как retryable `503 DB_TEMPORARILY_UNAVAILABLE` и учитывается в метрике `db_conn_error`, а не как `500 INTERNAL_ERROR`.

## 6. Historical Context

Удалённых access-control, validation, crypto или secret-handling checks в diff нет. Повторно добавленного ранее удалённого security-кода по `git log -S` не найдено.

История показывает последовательное ужесточение retry boundary: первоначальный broad classifier был заменён whitelist кодов в `2d07115`. Текущий stack fallback решает реальный incident, но снова делает correctness зависимым от неявного transport invariant.

## 7. Recommendations

### Immediate — completed

- [x] Убрать transparent retry mutations из общего proxy и добавить explicit safe-retry capability.
- [x] Добавить mutation и code-less transaction regression tests.

### Before Production

- [ ] Выполнить isolated Worker/Hyperdrive smoke: stale idle socket → безопасный read восстанавливается; mutation не повторяется без domain idempotency.
- [ ] Проверить метрики `db_conn_error`, scheduled failure и outbox queue age после canary.
- [ ] Не считать зелёные unit/build checks доказательством live Hyperdrive behavior.

### Existing Technical Debt

- [ ] Завершить оставшуюся часть TD-001: invocation-scoped ownership DB client. Explicit retry semantics выполнены.
- [ ] Выполнить TD-003B для outbox/audit/privacy durability boundaries.

## 8. Analysis Methodology

**Strategy:** SURGICAL — codebase LARGE (242 TypeScript/TSX/SQL/JS/MJS файла).

**Coverage:**

- Все 31 файла исходного scope классифицированы.
- Оба изменённых tracked-файла прочитаны полностью в baseline и working-tree версиях.
- Изучены 1-hop/critical consumers, production error artifact, текущий Worker bundle и релевантные `postgres.js 3.4.9` sources.
- Git history/blame проверены для classifier и retry wrapper.
- 29 новых Markdown-файлов проверены как non-runtime; выполнен узкий secret-pattern scan.

**Techniques:** diff-region review, git history/blame, call-site quantification, test-gap analysis, driver-source tracing, bundle inspection, adversarial failure modeling.

**Limitations:**

- Live Cloudflare Worker/Hyperdrive smoke не выполнялся.
- DB integration tests пропущены из-за отсутствия настроенного integration environment в текущем test run.
- Полноценный secret scanner по git history не запускался; выполнена только эвристика по новым Markdown-файлам.
- Worktree менялся параллельно: во время review появились дополнительные `tech_debt` документы. Финальный scope зафиксирован после стабилизации; scout fingerprint до стабилизации отклонён, выводы перепроверены локально.

**Confidence:** HIGH для diff, call graph и unit/build evidence; MEDIUM для фактической атомарности Cloudflare socket failure без live reproduction.

## 9. Validation Log

| Command | Result |
|---|---|
| `bun test backend/tests/db.test.ts` | ✅ 10 pass, 0 fail |
| `bun test backend/tests` | ✅ 192 pass, 17 skip, 0 fail |
| `bun run --cwd backend typecheck` | ✅ |
| `bun run --cwd backend build` | ✅ Bun bundle + Wrangler deploy dry-run |
| `git diff --check` | ✅ |

Первый sandbox build дошёл до dry-run, но Wrangler не смог записать служебный лог в macOS Preferences (`EPERM`). Повтор вне sandbox завершился с exit code 0. Никакого deploy и production mutation не выполнялось.

## 10. Final Recommendation

Текущий patch воспроизводит production stack, проходит unit/type/build проверки и делает retry явным свойством безопасной операции. Локальный merge можно одобрить; production incident остаётся частично проверенным до live Worker/Hyperdrive smoke.
