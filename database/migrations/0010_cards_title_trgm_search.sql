-- pg_trgm + GIN по cards.title для ускорения ILIKE '%...%' поиска.
-- Без частичного условия (published_at/archived_at) — adminListCards (repos/adminCatalog.ts)
-- ищет и по архивным/неопубликованным карточкам, частичный индекс их бы не ускорил.
-- Полный индекс дёшев: записи в cards редки (контент-менеджмент, не per-request нагрузка).
--
-- create index concurrently не может идти в одной транзакции с другими операторами — на
-- production применять этот файл двумя отдельными выполнениями (extension, затем index),
-- не одной вставленной пастой в SQL-клиенте, который может обернуть их в одну транзакцию.
create extension if not exists pg_trgm;

create index concurrently if not exists cards_title_trgm_idx
  on cards using gin (title gin_trgm_ops);
