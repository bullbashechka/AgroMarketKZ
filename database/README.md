# Database

PostgreSQL работает в Supabase. Production-миграции выполняются только через связанный
Supabase CLI project; runtime-подключение Worker должно использовать отдельную роль приложения,
а не административную роль миграций (см. `DEPLOYMENT.md`).

## Commands

```sh
bun run db:migrations:check
supabase migration list --linked
```

`database/migrations` — единственный source of truth. `manifest.json` фиксирует SHA-256,
Supabase version, compatibility, forward recovery, rollback note и read-only verification query
для каждой управляемой migration. `bun run db:migrations:check` блокирует drift: canonical catalog
и manifest должны быть полной упорядоченной bijection; управляемые файлы в `supabase/migrations`
должны быть ровно детерминированными symlink на canonical SQL, без missing, dangling или extra
файлов.

Восемь regular-файлов в `supabase/migrations` — immutable fetched evidence исторического remote
prefix до cutover. Они сознательно не переписываются в symlink: remote history собирался из
нескольких ранних файлов и не является byte-to-byte представлением современного canonical catalog.
Их SHA-256 также проверяется manifest-ом. Не использовать `migration repair` или менять этот
prefix без отдельного forensic решения.

Новая migration: добавить canonical SQL, отдельной записью добавить SHA-256 и все recovery notes
в manifest, выполнить `bun run db:migrations:sync`, затем `bun run db:migrations:check`. Для
destructive change в manifest ставится `requiresPitr: true`; до preflight нужен подтверждённый
PITR/backup и restore drill. Expand сначала добавляет совместимую схему, code rollout читает обе
формы, contract/remove выполняется только следующей migration после проверки данных. Ошибки
исправляются только forward migration, не изменением применённого SQL.

Production-путь всегда ровно для одной explicit version:

```sh
MIGRATION_TARGET_ENV=production \
MIGRATION_EXPECT_VERSION=20260826055721 \
bun run db:migrate:production:preflight

MIGRATION_TARGET_ENV=production \
MIGRATION_EXPECT_VERSION=20260826055721 \
MIGRATION_CONFIRM=APPLY:20260826055721 \
bun run db:migrate:production
```

Preflight выполняет только read-only native-ledger query и Supabase dry-run, требует выбранную
первую не применённую версию и блокирует любую unknown/missing/out-of-order историю. Для dry-run
и apply он строит во временной директории curated migration-set только до этой версии, поэтому
поздние pending файлы не могут попасть в `db push`. Production apply повторяет preflight
непосредственно перед push; default bulk команды нет.
После apply выполнить verification query из manifest и `supabase migration list --linked`.

Старый runner доступен только для disposable loopback DB:

```sh
TARGET_ENV=development MIGRATION_DATABASE_URL=postgresql://127.0.0.1:54322/postgres \
  bun run db:migrate:local
```

Supabase CLI выполняет migration-файлы в pipeline/транзакционном режиме, поэтому в этих файлах
нельзя использовать `CREATE INDEX CONCURRENTLY`.

`app_private.schema_migrations` — исторический checksum-ledger старого runner. В production он
сверен с файлами до `0019`; версии `0011–0014` однократно зарегистрированы в нативной истории
Supabase через `migration repair --status applied`, а `0015`–`0019` применены через `db push`.
Production source of truth — `supabase_migrations.schema_migrations`. Старый local runner не
использовать против production.

Migration `0021_admin_audit_outbox.sql` is prepared but not applied here. It makes administrator
audit intent transactional with the business mutation, fences notification and audit outbox
leases with processing tokens, and changes audit actor foreign keys to `ON DELETE SET NULL`.
Final audit rows remain append-only; `dead_letter` is an operator-visible terminal state and must
be explicitly requeued only after the underlying poison condition is understood.

Seed принимает только отдельный `DEV_DATABASE_URL` и `TARGET_ENV=development`, поэтому корневой
`.env`, указывающий на production, больше не может случайно наполнить демо-данными.

Пока корневой `.env` указывает на production, `bun run test:e2e` и `bun run load:test`
запрещены: оба выполняют auth upsert, а E2E дополнительно создаёт каталог и заявки.

## Supabase Storage

Bucket `card-images` (see `database/supabase/storage.sql`): public bucket, `file_size_limit = 8388608` (8 MiB), `allowed_mime_types = image/jpeg, image/png, image/webp`. No SELECT policy exists on `storage.objects` — anonymous/authenticated listing is denied. Direct object GET by URL still works because a public bucket serves objects without checking RLS policies.

Business data should be read and written through the backend API. Storage writes should also go through backend admin routes. The app stores object paths in `card_images.storage_path`, not public URLs.

E2E-загрузки изолированы префиксом `e2e/<run-id>/` и удаляются test-only teardown вместе с
unbound-объектами. Обычные production-загрузки используют `cards/<uuid>.<ext>` и попадают под
ежедневную reconciliation-задачу ниже.

Residual risk: the bucket validates the declared MIME type, not file magic bytes — acceptable for the current admin-only upload path.

Objects under `cards/` that are no longer referenced by any `card_images.storage_path` (abandoned uploads, best-effort deletes that failed) are not removed eagerly. The backend Worker's daily cron reconciles them against `card_images` and deletes only exact, unreferenced, 7+ day old paths — see `backend/README.md` for the job's dry-run/delete-mode toggle and limits.
