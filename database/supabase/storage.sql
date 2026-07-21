-- Supabase Storage: bucket для изображений карточек.
-- Выполнять в SQL-редакторе Supabase (Dashboard → SQL Editor) после создания проекта.
--
-- Модель доступа:
--   * Публичное чтение объектов через direct object URL (bucket public = true отдаёт
--     объект без проверки RLS-политик на storage.objects) — фото карточек открыты по URL.
--   * Никакой SELECT-политики на storage.objects нет: anonymous/authenticated listing
--     бакета и произвольные SELECT-запросы к таблице объектов запрещены.
--   * Запись/удаление — только через backend admin-маршруты с service_role ключом
--     (service_role обходит RLS, поэтому отдельная write-политика не нужна).
-- В БД хранится storage_path объекта (card_images.storage_path), а не публичный URL.
--
-- MIME/размер: bucket проверяет только заявленный Content-Type при upload, не magic
-- bytes файла. Для текущего admin-only upload этого достаточно; для будущих
-- пользовательских загрузок потребуется отдельная проверка содержимого.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'card-images', 'card-images', true,
  8388608, array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Широкая SELECT-политика "card-images public read" сознательно удалена (не воссоздаётся):
-- она разрешала anonymous listing бакета, что не нужно для доступа по direct object URL.
drop policy if exists "card-images public read" on storage.objects;
