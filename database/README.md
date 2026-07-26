# Database

Один Supabase Postgres используется и для локальной разработки, и для прода — Docker не нужен. Подключение берётся из `DATABASE_URL` (строка Supabase transaction pooler, см. корневой `.env.example`).

## Commands

```sh
bun run db:migrate     # применить SQL-миграции из database/migrations/*.sql к DATABASE_URL
bun run db:seed:dev     # демо-категории и карточки (опционально)
```

Скрипт не ведёт журнал применённых файлов и всегда выполняет каталог с начала. Поэтому он
подходит только для пустой безопасной БД. На production новую миграцию применять точечно через
Supabase MCP (`apply_migration`) или SQL Editor: повторный запуск `0008` меняет данные в
`platform_settings`.

Пока корневой `.env` указывает на production, `bun run test:e2e` и `bun run load:test`
запрещены: оба выполняют auth upsert, а E2E дополнительно создаёт каталог и заявки.

## Supabase Storage

Bucket `card-images` (see `database/supabase/storage.sql`): public bucket, `file_size_limit = 8388608` (8 MiB), `allowed_mime_types = image/jpeg, image/png, image/webp`. No SELECT policy exists on `storage.objects` — anonymous/authenticated listing is denied. Direct object GET by URL still works because a public bucket serves objects without checking RLS policies.

Business data should be read and written through the backend API. Storage writes should also go through backend admin routes. The app stores object paths in `card_images.storage_path`, not public URLs.

Residual risk: the bucket validates the declared MIME type, not file magic bytes — acceptable for the current admin-only upload path.

Objects under `cards/` that are no longer referenced by any `card_images.storage_path` (abandoned uploads, best-effort deletes that failed) are not removed eagerly. The backend Worker's daily cron reconciles them against `card_images` and deletes only exact, unreferenced, 7+ day old paths — see `backend/README.md` for the job's dry-run/delete-mode toggle and limits.
