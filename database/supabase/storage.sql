-- Supabase Storage: bucket для изображений карточек.
-- Выполнять в SQL-редакторе Supabase (Dashboard → SQL Editor) после создания проекта.
--
-- Модель доступа:
--   * Публичное чтение объектов (фото карточек открыты по публичному URL).
--   * Запись/удаление — только через backend admin-маршруты с service_role ключом
--     (service_role обходит RLS, поэтому отдельная write-политика не нужна).
-- В БД хранится storage_path объекта (card_images.storage_path), а не публичный URL.

insert into storage.buckets (id, name, public)
values ('card-images', 'card-images', true)
on conflict (id) do update set public = excluded.public;

-- Публичное чтение объектов бакета card-images.
drop policy if exists "card-images public read" on storage.objects;
create policy "card-images public read"
  on storage.objects
  for select
  using (bucket_id = 'card-images');
