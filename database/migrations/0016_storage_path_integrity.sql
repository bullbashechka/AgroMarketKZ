-- A storage object must be globally owned by one card. Existing production
-- data was preflighted for duplicates and invalid values before this migration.

alter table public.card_images
  add constraint card_images_storage_path_shape
  check (
    storage_path ~ '^(cards/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)|e2e/[A-Za-z0-9-]{1,32}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp))$'
  ) not valid;

create unique index concurrently if not exists card_images_storage_path_uidx
  on public.card_images (storage_path);
