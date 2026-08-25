# Architecture review — technical debt audit

**Дата:** 2026-08-25  
**Scope:** contracts, backend/Worker, webapp/Pages proxy, database/migrations, tests и deployment runbook.  
**Verdict:** архитектура modular monolith соответствует масштабу, но несколько critical runtime boundaries держатся на неявных invariants и ручной дисциплине. Нужен targeted hardening, не replatforming.

## System map

Telegram Mini App (React/Vite) → Pages proxy → Hono Worker → PostgreSQL через Hyperdrive / Supabase Storage / Telegram API. Shared Zod contracts — compile/runtime boundary; Queue и scheduled handlers исполняют notifications, updates, retention/backup/cleanup. Pages, Worker и DB миграции выпускаются раздельно.

## Findings по линзам

### Correctness/security — critical

- Module-global DB client и общий reconnect proxy могут повторить write после ambiguous commit; TD-001.
- Session rotation не атомарна, а revoke не блокирует reuse старого Mini App proof; TD-002.
- Pages/Worker protocol почти не имеет прямых tests; outbox/audit/privacy recovery также слабо защищён, а audit пропускает denied/failed и может дать 500 после committed mutation; TD-003A/003B.
- Profile UI теряет signed Telegram contact proof; TD-004.
- Publication policy имеет две независимые реализации; TD-005.

### Simplicity/maintainability

- `CardEditorScreen.tsx` (1095 строк, около 30 state slots) смешивает model, recovery, uploads, payload, preview и UI; TD-006.
- `adminCatalog.ts` (1126 строк) смешивает categories, reads, writes, lifecycle и mappers; TD-007.
- API client делает unchecked cast, query keys/proxy protocol распределены; TD-008.
- Это не аргумент за микросервисы/generic repository/state machine. Нужны pure policy/model и несколько use-case boundaries.

### Performance/reliability

- Main JS 532.68 kB minified и eager imports грузят admin/editor на catalog cold start; TD-009.
- Нет достаточных latency/queue-age signals, DLQ operational loop не закрыт; TD-010.
- External/maintenance I/O имеет неполный timeout/deadline/checkpoint contract; TD-011.
- Favorites list не bounded; TD-015. Keyset для остальных списков — только после метрик, TD-205.

### Deployability/data

- Canonical SQL, Supabase symlinks/native ledger и legacy custom ledger могут расходиться; TD-012.
- Документы и generated env types сохраняют JWT/старый backlog; TD-013.
- Pages auto-production, Worker manual, schema отдельно; canary и alerts зависят от ручного исполнения. Ближайший слой — TD-003A/010/012/019, production-like staging — TD-207.
- Legacy location и wide nullable variants требуют отдельного решения. Recovery/grants evidence снимается в TD-017/018, дорогая реализация backup/credential segmentation остаётся TD-203/204.

## Verification baseline

- Typecheck, build, 244 unit/contract tests и 29 helper/script tests прошли; 17 DB integration tests skipped.
- Coverage snapshot: 55.54% functions / 67.27% lines, непригоден как target, но выявил critical gaps.
- Integration harness не стартовал из-за exhaustion macOS shared-memory IDs; это не verdict по коду.
- Dependency audit high — без известных findings; full-history secret scanner отсутствовал.

## Recommended sequence

1. TD-001–003B, P0 milestones TD-010/012: убрать correctness/security/release ambiguity и создать executable boundaries.
2. TD-004–009, TD-011–014, TD-017–019: сократить стоимость изменений, cold start и operational uncertainty.
3. TD-015–016 при касании соответствующего UX.
4. TD-201–207 только по описанным triggers и отдельному решению.

Полный acceptance/TDD/rollback контекст находится в `tech_debt/README.md` и отдельных task-файлах.
