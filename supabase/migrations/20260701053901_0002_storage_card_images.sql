insert into storage.buckets (id, name, public)
values ('card-images', 'card-images', true)
on conflict (id) do update set public = excluded.public;

drop policy if exists "card-images public read" on storage.objects;
create policy "card-images public read"
  on storage.objects
  for select
  using (bucket_id = 'card-images');
;
