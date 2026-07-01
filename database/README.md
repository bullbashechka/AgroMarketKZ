# Database

Один Supabase Postgres используется и для локальной разработки, и для прода — Docker не нужен. Подключение берётся из `DATABASE_URL` (строка Supabase transaction pooler, см. корневой `.env.example`).

## Commands

```sh
bun run db:migrate     # применить SQL-миграции из database/migrations/*.sql к DATABASE_URL
bun run db:seed:dev     # демо-категории и карточки (опционально)
```

Также миграции можно применять через Supabase MCP (`apply_migration`) или SQL Editor в Dashboard — эквивалентно `db:migrate`.

## Supabase Storage

Create a public bucket named `card-images`.

Business data should be read and written through the backend API. Storage writes should also go through backend admin routes. The app stores object paths in `card_images.storage_path`, not public URLs.
