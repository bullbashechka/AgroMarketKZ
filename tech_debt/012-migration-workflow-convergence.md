# TD-012 — Единый и безопасный migration workflow

**Приоритет:** P0 gate до любой следующей production migration; иначе P1  
**Этап:** 1  
**Оценка:** S–M  
**Зависимости:** нет; выполнить до следующей production schema change.

**Статус:** ✅ закрыта 26.08.2026. Production inventory снят read-only: native
`supabase_migrations.schema_migrations` и historical `app_private.schema_migrations` согласованы
до `0019`; `0020` и `0021` остаются pending и этой задачей не применялись. Disposable development
путь покрыт isolated zero/N−1 upgrade test без production secrets. Финальный независимый review:
**8/10**, actionable P0–P2 нет.

## Проблема

Canonical SQL находится в `database/migrations`, Supabase CLI видит symlinks в `supabase/migrations`, а старый root `db:migrate` ведёт собственный `app_private.schema_migrations`. Три представления одной истории могут разойтись; root command способен повторно рассматривать уже применённые native Supabase migrations. Runbook предупреждает об этом, но automation не запрещает ошибочный путь.

## План

1. Снять read-only production/dev ledger inventory и сопоставить filename, checksum, Supabase version и custom ledger. Ничего не применять в этой задаче без отдельной авторизации.
2. Выбрать `database/migrations` как единственный source; Supabase directory генерировать/проверять детерминированно. Добавить fitness check: только symlinks, полный ordered bijection, одинаковые checksums, no dangling links.
3. Переименовать/ограничить опасный root command: production path должен требовать один explicit file/version и preflight; bulk runner оставить только для disposable local DB или удалить после доказанного перехода.
4. Документировать expand/contract, forward recovery, pre/post read-only queries и backup/PITR prerequisite для destructive change.
5. Добавить isolated migration-from-zero и upgrade-from-previous snapshot tests.

## Критерии приёмки

- Один authoritative ledger/workflow; drift обнаруживается до deploy.
- Ни одна production команда по умолчанию не replay-ит весь каталог.
- Каждая новая migration имеет checksum, compatibility/rollback note и verification query.
- Local zero/upgrade test проходит без production secrets.

## Проверка и ловушки

```sh
bun run db:migrations:check
bun run test:integration
```

Не переписывать уже применённые SQL-файлы и не «чинить» ledger UPDATE-ом без forensic evidence. Symlink portability проверить на Cloudflare/build host.

## Вероятные файлы

`database/migrations`, `supabase/migrations`, migration scripts, root `package.json`, `database/README.md`, `DEPLOYMENT.md`.

## Выполнено

- `database/migrations/manifest.json` стал проверяемым source map: SHA-256, version mapping,
  compatibility, forward recovery, rollback note и verification SQL.
- `bun run db:migrations:sync` создаёт только отсутствующие deterministic symlink, а
  `bun run db:migrations:check` ловит checksum drift, missing/extra/copy/dangling mappings.
  Восемь fetched historical files сохранены как immutable evidence, без переписывания applied SQL.
- Root bulk commands удалены. Legacy runner принимает только loopback `TARGET_ENV=development`;
  production wrapper требует explicit version, project-ref guard, ledger preflight и confirmation.
  Он использует temporary curated migration-set, поэтому следующая pending migration не может
  быть случайно применена batch-ом.
- `test:integration` теперь проверяет миграции от нуля и upgrade с предыдущего migration prefix;
  privacy concurrency checks используют transaction-lock barrier вместо sleep.
- Проверки: `bun run db:migrations:sync`, `bun run db:migrations:check`,
  `bun test backend/tests/checkMigrations.test.ts`, `bun run typecheck`, `bun run test:integration`,
  read-only production preflight для `20260826055721` — успешно.
