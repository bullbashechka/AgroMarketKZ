# Database

Local PostgreSQL uses the connection string from `DATABASE_URL`. If it is not set, the root scripts fall back to:

```sh
postgresql://agromarket:agromarket@localhost:5433/agromarketkz
```

> Локальный Docker-контейнер мапится на порт **5433** (чтобы не конфликтовать с нативной PostgreSQL на 5432).

## Commands

```sh
docker compose up -d postgres
bun run db:migrate
bun run db:seed:dev
```

## Supabase Storage

Create a public bucket named `card-images`.

Business data should be read and written through the backend API. Storage writes should also go through backend admin routes. The app stores object paths in `card_images.storage_path`, not public URLs.
