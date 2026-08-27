# Реестр технического долга AgroMarketKZ

_Аудит: 2026-08-25. Основание: текущий `HEAD 93d002d`, статический разбор всех workspace, измеренный build/test baseline и независимые архитектурные проходы. Реестр не является разрешением на production-изменения._

## Как читать приоритет

- **P0** — риск корректности, безопасности или потери управляемости уже находится на критическом runtime-пути. Брать первым.
- **P1** — высокая ближайшая отдача: дешевле менять продукт, быстрее Mini App, надёжнее релиз и эксплуатация.
- **P2** — полезный локальный долг без текущего инцидента; делать после P0/P1 либо вместе с затрагивающей этот код функцией.
- **Stage 2** — более дорогие решения. Они требуют измеримого триггера, production-аудита данных или отдельного продуктового/операционного решения.

Порядок ниже учитывает не только серьёзность, но и зависимости: сначала создаются проверяемые границы и устраняются неоднозначные runtime-механики, затем режутся god-модули.

## Этап 1 — максимальная отдача в ближайшее время

| № | Приоритет | Задача | Зачем сейчас |
|---|---|---|---|
| 001 | P0 | ✅ [Безопасное владение DB-клиентом и явные ретраи](001-db-client-lifecycle-and-retries.md) | Убрать module-global pool и прозрачный повтор неоднозначных write-запросов. |
| 002 | P0 | ✅ [Атомарные сессии и полноценный отзыв credentials](002-session-rotation-and-revocation.md) | Закрыть race ротации, write amplification и повторный вход по старому Telegram proof. |
| 003A | P0 | ✅ [Contract tests для Pages/Worker/scheduled runtime](003a-runtime-protocol-tests.md) | Защитить security/dispatch protocol на production entrypoints. |
| 003B | P0 | ✅ [Durability tests для outbox/audit/privacy](003b-persistence-durability-tests.md) | Сделать executable критичные DB recovery и audit outcomes. |
| 012 | P0 gate | ✅ [Единый и безопасный migration workflow](012-migration-workflow-convergence.md) | Canonical manifest/checks, explicit-version production preflight и local zero/N−1 upgrade test. |
| 010 | P0 gate / P1 | ✅ [Наблюдаемость, DLQ и operational closure](010-observability-dlq-and-operations.md) | Закрыта 27.08.2026: monitoring preflight и операторский контур готовы. |
| 004 | P1 | ✅ [Верификация телефона при редактировании профиля](004-profile-phone-verification.md) | Закрыта 27.08.2026: signed proof проходит profile edit и подтверждает только совпавший номер. |
| 005 | P1 | ✅ [Единая политика публикации и видимости карточек](005-publication-policy-single-source.md) | Закрыта 27.08.2026: typed policy едина для Zod/UI/backend, публичная видимость покрыта integration-контрактом. |
| 006 | P1 | ✅ [TDD-рефакторинг модели и workflow редактора карточки](006-card-editor-model-and-workflow.md) | Закрыта 27.08.2026: editor model централизует переходы и проекции draft/mutation/preview. |
| 007 | P1 | ✅ [Разделение adminCatalog и единый card read model](007-admin-catalog-boundaries.md) | Закрыта 27.08.2026: category/read/lifecycle boundaries и publication adapters покрыты integration-characterization tests. |
| 008 | P1 | ✅ [Типизированная API и cache boundary](008-typed-api-and-cache-boundary.md) | Закрыта 27.08.2026: critical response schemas и catalog cache ownership защищают malformed API payload и stale cache. |
| 009 | P1 | ✅ [Route splitting и бюджет стартового bundle](009-route-splitting-and-bundle-budget.md) | Закрыта 27.08.2026: вторичные маршруты вынесены, initial graph ограничен проверяемым budget. |
| 011 | P1 | ✅ [Надёжность Storage/Telegram/maintenance I/O](011-external-io-resilience.md) | Закрыта 27.08.2026: bounded I/O и durable maintenance checkpoints. |
| 013 | P1 | [Выровнять документацию, env и исторический backlog](013-docs-config-and-backlog-alignment.md) | README/TASKS всё ещё описывают JWT и уже закрытые находки как текущую систему. |
| 014 | P1 | [Минимальные quality/security gates](014-quality-and-secret-gates.md) | Нет lint/no-floating-promises, secret-history scan и автоматической политики обновлений. |
| 017 | P1 | [Read-only backup/PITR evidence и restore plan](017-backup-and-restore-evidence.md) | Дёшево снять неизвестность RPO/RTO до построения нового backup-механизма. |
| 018 | P1 | [Effective grants и runtime capability audit](018-runtime-capability-audit.md) | Измерить реальный blast radius до дорогой сегментации credentials. |
| 019 | P1 | [Verified release descriptor и read-only preflight](019-verified-release-descriptor.md) | Связать Pages, Worker и migration state без нового staging/CI. |
| 015 | P2 | [Пагинация избранного](015-favorites-pagination.md) | Единственный явно неограниченный пользовательский list endpoint. |
| 016 | P2 | [Общая orchestration-модель каталога](016-catalog-screen-orchestration.md) | `CatalogTab` и `CategoryScreen` дублируют поиск, фильтры, URL и CTA. |

## Этап 2 — отдельно обсудить перед внедрением

| № | Задача | Включать только если |
|---|---|---|
| 201 | [Sunset legacy location и прекращение dual-write](stage-2/201-legacy-location-sunset.md) | Подтверждены backfill и отсутствие нужных legacy-строк в production. |
| 202 | [Discriminated catalog variants](stage-2/202-discriminated-catalog-variants.md) | Планируется новый тип карточки/вариант или следующий большой каталоговый апгрейд. |
| 203 | [Durable maintenance, backup и restore](stage-2/203-durable-maintenance-and-backup.md) | Объёмы приближаются к cron-бюджетам либо R2/PITR утверждены как обязательные. |
| 204 | [Сегментация runtime credentials](stage-2/204-runtime-credential-segmentation.md) | Требуется уменьшить blast radius компрометации Worker и понятна цена отдельного boundary. |
| 205 | [Keyset pagination](stage-2/205-keyset-pagination.md) | EXPLAIN/метрики показывают deep-offset degradation. |
| 206 | [Server-driven taxonomy](stage-2/206-server-driven-taxonomy.md) | Taxonomy реально меняется чаще релиза либо surfaces расходятся. |
| 207 | [Staging, compatibility matrix и управляемый rollout](stage-2/207-staging-and-rollout.md) | TD-019 внедрён, а команда готова обслуживать production-like ресурсы. |

## Что сознательно не превращено в задачу

- Не предлагается переход на микросервисы, CQRS, event sourcing, generic repository или state-machine library: текущий modular monolith соответствует масштабу.
- `components.css` большой (1435 строк), но организован функциональными секциями и сам по себе не является текущим bottleneck. Делить его следует только вместе с реальной изоляцией компонентов.
- Offset pagination в основных catalog/admin/request списках пока ограничена страницами и не доказана как проблема. Дорогая замена оставлена Stage 2 до измерения.
- Wrangler TOML остаётся допустимым для существующего проекта; миграция формата конфигурации не даёт достаточной отдачи отдельно от реального config change.
- SQL constraints и server-side validation не считаются вредным дублированием: это разные линии защиты. Долг — несколько расходящихся application-level политик.

## Baseline аудита

- `bun run typecheck` — успешно.
- `bun test --coverage backend/tests packages/contracts/tests webapp/tests` — 244 pass, 17 DB integration tests skipped, 0 fail; измерение 55.54% functions / 67.27% lines искажено отсутствием integration env и двойным учётом built contracts, поэтому используется только для поиска провалов, а не как KPI.
- `bun test e2e/helpers e2e/scripts` — 29 pass, 0 fail.
- `bun audit --audit-level high` — уязвимости не найдены.
- `bun run build` — успешно; main webapp chunk 532.68 kB minified / 151.75 kB gzip, Vite выдал предупреждение >500 kB.
- `bun run test:integration` — успешно: isolated PostgreSQL применил migrations и выполнил catalog/session/outbox/audit/privacy persistence suites без пропусков.
- TD-012: `bun run db:migrations:check` и read-only production preflight для первой pending
  `20260826055721` успешны; production SQL не применялся.
- Полный GitLeaks/TruffleHog scan не выполнен: инструмент отсутствует. Path-only эвристика истории нашла только кандидаты в example/docs, но не заменяет redacted secret scanner.
- E2E journeys не запускались: они требуют изолированные `E2E_*` DB/Storage/Telegram ресурсы и намеренно блокируют production baseline.
