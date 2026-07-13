alter table categories
  add column if not exists required_specs text[] not null default '{}';

alter table cards
  add column if not exists price_unit text,
  add column if not exists price_reason text,
  add column if not exists location text,
  add column if not exists availability text;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'cards' and column_name = 'published_at'
  ) then
    alter table cards add column published_at timestamptz;
    update cards set published_at = created_at;
  end if;
end $$;

alter table requests
  add column if not exists client_request_id uuid,
  add column if not exists request_payload_hash text,
  add column if not exists card_price_unit_snapshot text,
  add column if not exists card_price_reason_snapshot text;

alter table cards drop constraint if exists cards_valid_price;
alter table cards
  add constraint cards_valid_price check (
    (price_amount is null or price_amount > 0)
    and (price_type <> 'on_request' or price_amount is null)
    and (price_type <> 'fixed' or price_reason is null)
  );

alter table cards drop constraint if exists cards_archived_requires_publication;
alter table cards
  add constraint cards_archived_requires_publication check (
    archived_at is null or published_at is not null
  );

-- Старые опубликованные карточки намеренно могут остаться неполными и получить
-- needsReview. NOT VALID проверяет новые/изменяемые строки, не ломая backfill.
alter table cards drop constraint if exists cards_published_price_complete;
alter table cards
  add constraint cards_published_price_complete check (
    published_at is null
    or
    (
      price_unit is not null
      and length(btrim(price_unit)) > 0
      and (
        (price_type in ('fixed', 'from') and price_amount is not null and price_amount > 0)
        or
        (
          price_type = 'on_request'
          and price_amount is null
          and price_reason is not null
          and length(btrim(price_reason)) > 0
        )
      )
    )
  ) not valid;

alter table cards drop constraint if exists cards_price_unit_not_blank;
alter table cards
  add constraint cards_price_unit_not_blank check (
    price_unit is null or length(btrim(price_unit)) > 0
  );

alter table cards drop constraint if exists cards_price_reason_not_blank;
alter table cards
  add constraint cards_price_reason_not_blank check (
    price_reason is null or length(btrim(price_reason)) > 0
  );

alter table cards drop constraint if exists cards_location_not_blank;
alter table cards
  add constraint cards_location_not_blank check (
    location is null or length(btrim(location)) > 0
  );

alter table cards drop constraint if exists cards_availability_not_blank;
alter table cards
  add constraint cards_availability_not_blank check (
    availability is null or length(btrim(availability)) > 0
  );

alter table requests drop constraint if exists requests_request_payload_hash_not_blank;
alter table requests
  add constraint requests_request_payload_hash_not_blank check (
    request_payload_hash is null or length(btrim(request_payload_hash)) > 0
  );

alter table requests drop constraint if exists requests_card_price_unit_snapshot_not_blank;
alter table requests
  add constraint requests_card_price_unit_snapshot_not_blank check (
    card_price_unit_snapshot is null or length(btrim(card_price_unit_snapshot)) > 0
  );

alter table requests drop constraint if exists requests_card_price_reason_snapshot_not_blank;
alter table requests
  add constraint requests_card_price_reason_snapshot_not_blank check (
    card_price_reason_snapshot is null or length(btrim(card_price_reason_snapshot)) > 0
  );

alter table requests drop constraint if exists requests_valid_card_price_snapshot;
alter table requests
  add constraint requests_valid_card_price_snapshot check (
    source <> 'card'
    or
    (
      (card_price_type_snapshot in ('fixed', 'from') and card_price_amount_snapshot is not null and card_price_amount_snapshot > 0)
      or
      (card_price_type_snapshot = 'on_request' and card_price_amount_snapshot is null)
    )
  );

create unique index if not exists requests_user_client_request_uidx
  on requests (user_id, client_request_id)
  where client_request_id is not null;

drop index if exists cards_active_catalog_idx;
drop index if exists cards_type_title_idx;

create index if not exists cards_published_catalog_idx
  on cards (type, category_id, sort_order, title)
  where published_at is not null and archived_at is null;

create index if not exists cards_published_type_title_idx
  on cards (type, btrim(title))
  where published_at is not null and archived_at is null;

create index if not exists cards_publication_status_idx
  on cards (published_at, archived_at, updated_at desc);
