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
| 017 | P1 | ✅ [Read-only backup/PITR evidence и restore plan](017-backup-and-restore-evidence.md) | Закрыта 31.08.2026: production PITR/backup и R2 не настроены; failed state стал P0 gate, remediation — TD-203. |
| 018 | P1 | ✅ [Effective grants и runtime capability audit](018-runtime-capability-audit.md) | Закрыта 31.08.2026: read-only audit, role-boundary test и remediation ledger; production grants не менялись. |
| 019 | P1 | ✅ [Verified release descriptor и read-only preflight](019-verified-release-descriptor.md) | Закрыта 31.08.2026: versioned descriptor и fail-closed read-only preflight связывают Pages, Worker и migration ledger. |
| 015 | P2 | ✅ [Пагинация избранного](015-favorites-pagination.md) | Закрыта 31.08.2026: opt-in cursor pagination, deterministic microsecond cursor, bounded membership batches и load-more UX; legacy array сохранён на время rollout. |
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
- `bun run db:migrations:check` и read-only production preflight для первой pending
  `20260826055721` успешны; production SQL не применялся.
- Полный GitLeaks/TruffleHog scan не выполнен: инструмент отсутствует. Path-only эвристика истории нашла только кандидаты в example/docs, но не заменяет redacted secret scanner.
- E2E journeys не запускались: они требуют изолированные `E2E_*` DB/Storage/Telegram ресурсы и намеренно блокируют production baseline.
