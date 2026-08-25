# Database

Один Supabase Postgres используется и для локальной разработки, и для прода — Docker не нужен. Runtime-подключение берётся из `DATABASE_URL` и должно использовать отдельную роль приложения; административный URL миграций (`MIGRATION_DATABASE_URL`) хранится отдельно и в Worker не передаётся (см. `DEPLOYMENT.md`).

## Commands

```sh
 MIGRATION_DATABASE_URL="$DEV_DATABASE_URL" TARGET_ENV=development bun run db:migrate
 DEV_DATABASE_URL="postgresql://...локальная/стейджинг-БД..." TARGET_ENV=development bun run db:seed:dev
```

Миграции теперь выполняются журналируемым runner в `app_private.schema_migrations`: он держит
advisory lock, проверяет SHA-256 checksum и не повторяет уже применённый файл. Для существующей
БД первый запуск должен явно зарегистрировать известную базу (`MIGRATION_BASELINE_VERSION=0013`)
после read-only проверки таблиц. Для production дополнительно требуется
`MIGRATION_CONFIRM=APPLY`; обычный `DATABASE_URL` намеренно не принимается.

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
