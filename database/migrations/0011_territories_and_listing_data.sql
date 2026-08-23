-- Стандартизированные территории, параметры карточек и предложения на публикацию.
-- Миграция только добавляет данные и поля: legacy cards.location остаётся до отдельного cleanup-релиза.

begin;

-- PostgreSQL deployments may use the C locale, where lower()/~* do not fold
-- Cyrillic case. These transaction-local helpers keep migration matching
-- consistent with the case-insensitive contract validation without leaving
-- permanent helper functions in the public schema.
create or replace function pg_temp.legacy_catalog_fold(value text)
returns text
language sql
immutable
as $$
  select lower(translate(
    value,
    'АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ',
    'абвгдеёжзийклмнопрстуфхцчшщъыьэюя'
  ));
$$;

create or replace function pg_temp.legacy_catalog_normalize(value text)
returns text
language sql
immutable
as $$
  select regexp_replace(
    regexp_replace(
      regexp_replace(value, 'МАСЛЯНИЧ', 'МАСЛИЧ', 'g'),
      'Маслянич', 'Маслич', 'g'
    ),
    'маслянич', 'маслич', 'g'
  );
$$;

create table if not exists territories (
  code text primary key,
  name text not null unique,
  kind text not null,
  sort_order integer not null,
  constraint territories_code_not_blank check (length(btrim(code)) > 0),
  constraint territories_name_not_blank check (length(btrim(name)) > 0),
  constraint territories_kind_valid check (kind in ('region', 'republican_city')),
  constraint territories_sort_order_nonnegative check (sort_order >= 0)
);

insert into territories (code, name, kind, sort_order) values
  ('abay_region', 'Абайская область', 'region', 10),
  ('akmola_region', 'Акмолинская область', 'region', 20),
  ('aktobe_region', 'Актюбинская область', 'region', 30),
  ('almaty_region', 'Алматинская область', 'region', 40),
  ('atyrau_region', 'Атырауская область', 'region', 50),
  ('east_kazakhstan_region', 'Восточно-Казахстанская область', 'region', 60),
  ('zhambyl_region', 'Жамбылская область', 'region', 70),
  ('zhetysu_region', 'Жетысуская область', 'region', 80),
  ('west_kazakhstan_region', 'Западно-Казахстанская область', 'region', 90),
  ('karaganda_region', 'Карагандинская область', 'region', 100),
  ('kostanay_region', 'Костанайская область', 'region', 110),
  ('kyzylorda_region', 'Кызылординская область', 'region', 120),
  ('mangystau_region', 'Мангистауская область', 'region', 130),
  ('pavlodar_region', 'Павлодарская область', 'region', 140),
  ('north_kazakhstan_region', 'Северо-Казахстанская область', 'region', 150),
  ('turkistan_region', 'Туркестанская область', 'region', 160),
  ('ulytau_region', 'Улытауская область', 'region', 170),
  ('almaty_city', 'Алматы', 'republican_city', 180),
  ('astana_city', 'Астана', 'republican_city', 190),
  ('shymkent_city', 'Шымкент', 'republican_city', 200)
on conflict (code) do update set
  name = excluded.name,
  kind = excluded.kind,
  sort_order = excluded.sort_order;

alter table cards
  add column if not exists territory_code text references territories (code),
  add column if not exists ownership_form text,
  add column if not exists product_location text,
  add column if not exists product_location_detail text,
  add column if not exists service_all_kazakhstan boolean not null default false,
  add column if not exists version integer not null default 1;

-- Старое NOT VALID правило цены всё равно проверяется на каждом UPDATE. Временно
-- снимаем его, чтобы исправление опечаток не падало на legacy-карточках, а затем
-- возвращаем с явным исключением для архива (такие карточки можно безопасно скрыть).
alter table cards drop constraint if exists cards_published_price_complete;

-- Детерминированно переносим legacy-географию после снятия старого ограничения
-- цены и до новых NOT VALID-ограничений: последующие UPDATE опубликованной
-- карточки должны иметь шанс пройти новые проверки. Не угадываем неоднозначные
-- значения вроде «Казахстан» для товара.
update cards as c
set territory_code = t.code
from territories as t
where c.type = 'product'
  and c.territory_code is null
  and c.location is not null
  and pg_temp.legacy_catalog_fold(btrim(c.location)) = pg_temp.legacy_catalog_fold(btrim(t.name));

update cards
set territory_code = 'north_kazakhstan_region'
where type = 'product'
  and territory_code is null
  and pg_temp.legacy_catalog_fold(btrim(location)) in ('северный казахстан', 'северный регион');

update cards
set service_all_kazakhstan = true
where type = 'service'
  and service_all_kazakhstan = false
  and pg_temp.legacy_catalog_fold(btrim(location)) in ('казахстан', 'по казахстану', 'весь казахстан', 'по всему казахстану');

-- Исправляем legacy-контент до новых NOT VALID ограничений: они не проверяют
-- старые строки при создании, но применяются к любой последующей UPDATE.
update categories as category
set name = pg_temp.legacy_catalog_normalize(category.name)
where pg_temp.legacy_catalog_fold(category.name) like '%маслянич%'
  and not exists (
    select 1
    from categories as other
    where other.id <> category.id
      and other.type = category.type
      and other.is_active
      and category.is_active
      and pg_temp.legacy_catalog_fold(pg_temp.legacy_catalog_normalize(other.name))
        = pg_temp.legacy_catalog_fold(pg_temp.legacy_catalog_normalize(category.name))
  );

update cards set
  title = pg_temp.legacy_catalog_normalize(title),
  description = pg_temp.legacy_catalog_normalize(description)
where pg_temp.legacy_catalog_fold(title) like '%маслянич%'
   or pg_temp.legacy_catalog_fold(description) like '%маслянич%';

-- Сначала группируем опечатанные ключи с уже исправленными ключами той же
-- карточки. Выбираем исправленный ключ как survivor, а при нескольких старых
-- вариантах — запись с минимальным UUID; значения объединяем, чтобы не терять
-- данные. Удаление дубликатов до UPDATE сохраняет уникальный индекс
-- card_specs_card_key_uidx и позволяет нормализовать все оставшиеся ключи.
create temporary table legacy_card_spec_normalization on commit drop as
with candidates as (
  select
    spec.id,
    spec.card_id,
    btrim(pg_temp.legacy_catalog_normalize(spec.key)) as normalized_key,
    btrim(pg_temp.legacy_catalog_normalize(spec.value)) as value,
    pg_temp.legacy_catalog_fold(pg_temp.legacy_catalog_normalize(spec.key)) as normalized_group_key,
    (pg_temp.legacy_catalog_fold(spec.key) like '%маслянич%')::integer as survivor_priority
  from card_specs as spec
  where pg_temp.legacy_catalog_fold(spec.key) like '%маслянич%'
     or exists (
       select 1
       from card_specs as typo
       where typo.card_id = spec.card_id
         and pg_temp.legacy_catalog_fold(typo.key) like '%маслянич%'
         and pg_temp.legacy_catalog_fold(pg_temp.legacy_catalog_normalize(typo.key))
           = pg_temp.legacy_catalog_fold(btrim(spec.key))
     )
), survivors as (
  select distinct on (card_id, normalized_group_key)
    card_id, normalized_group_key, id as survivor_id
  from candidates
  order by card_id, normalized_group_key, survivor_priority, id
), merged_values as (
  select
    card_id,
    normalized_group_key,
    string_agg(distinct btrim(value), ' / ' order by btrim(value)) as merged_value
  from candidates
  group by card_id, normalized_group_key
)
select
  candidates.id,
  candidates.card_id,
  candidates.normalized_key,
  survivors.survivor_id,
  merged_values.merged_value
from candidates
join survivors using (card_id, normalized_group_key)
join merged_values using (card_id, normalized_group_key);

delete from card_specs as spec
using legacy_card_spec_normalization as normalized
where spec.id = normalized.id
  and normalized.id <> normalized.survivor_id;

update card_specs as spec
set
  key = normalized.normalized_key,
  value = normalized.merged_value
from legacy_card_spec_normalization as normalized
where spec.id = normalized.survivor_id;

update requests set card_title_snapshot = pg_temp.legacy_catalog_normalize(card_title_snapshot)
where pg_temp.legacy_catalog_fold(card_title_snapshot) like '%маслянич%';

alter table cards add constraint cards_published_price_complete check (
  published_at is null
  or archived_at is not null
  or (
    price_unit is not null
    and length(btrim(price_unit)) > 0
    and (
      (price_type in ('fixed', 'from') and price_amount is not null and price_amount > 0)
      or (
        price_type = 'on_request'
        and price_amount is null
        and price_reason is not null
        and length(btrim(price_reason)) > 0
      )
    )
  )
) not valid;

alter table cards drop constraint if exists cards_ownership_form_valid;
alter table cards add constraint cards_ownership_form_valid check (
  ownership_form is null or ownership_form in (
    'peasant_farm', 'llp_vat_agricultural_producer', 'llp_trader'
  )
);

alter table cards drop constraint if exists cards_product_location_valid;
alter table cards add constraint cards_product_location_valid check (
  product_location is null or product_location in ('elevator', 'seller_site')
);

alter table cards drop constraint if exists cards_product_location_detail_not_blank;
alter table cards add constraint cards_product_location_detail_not_blank check (
  product_location_detail is null
  or (length(btrim(product_location_detail)) between 1 and 200)
);

alter table cards drop constraint if exists cards_version_positive;
alter table cards add constraint cards_version_positive check (version > 0);

alter table cards drop constraint if exists cards_type_specific_fields;
alter table cards add constraint cards_type_specific_fields check (
  (type = 'product' and service_all_kazakhstan = false)
  or
  (
    type = 'service'
    and territory_code is null
    and ownership_form is null
    and product_location is null
    and product_location_detail is null
  )
) not valid;

-- Старые опубликованные карточки намеренно могут быть неполными до ручного backfill.
-- NOT VALID применяет правило ко всем новым и изменяемым строкам, не скрывая старые.
alter table cards drop constraint if exists cards_published_product_fields_complete;
alter table cards add constraint cards_published_product_fields_complete check (
  type <> 'product'
  or published_at is null
  or archived_at is not null
  or (
    territory_code is not null
    and ownership_form is not null
    and product_location is not null
  )
) not valid;

create table if not exists card_service_territories (
  card_id uuid not null references cards (id) on delete cascade,
  territory_code text not null references territories (code),
  sort_order integer not null default 0,
  primary key (card_id, territory_code),
  constraint card_service_territories_sort_order_nonnegative check (sort_order >= 0),
  constraint card_service_territories_card_sort_unique unique (card_id, sort_order)
);

-- Переносим однозначно распознаваемые legacy-локации услуг в relation-таблицу.
-- Не создаём ложные совпадения для свободного текста и не трогаем nationwide-карточки.
insert into card_service_territories (card_id, territory_code, sort_order)
select
  c.id,
  t.code,
  (row_number() over (partition by c.id order by t.sort_order) - 1)::integer
from cards as c
join territories as t
  on c.type = 'service'
 and c.service_all_kazakhstan = false
 and c.location is not null
 and strpos(
   pg_temp.legacy_catalog_fold(c.location),
   pg_temp.legacy_catalog_fold(t.name)
 ) > 0
where not exists (
  select 1 from card_service_territories existing where existing.card_id = c.id
)
on conflict do nothing;

alter table requests
  add column if not exists listing_submission_type catalog_type,
  add column if not exists submission_category_id uuid references categories (id) on delete set null,
  add column if not exists submission_category_name_snapshot text,
  add column if not exists submission_territory_code text references territories (code),
  add column if not exists submission_ownership_form text,
  add column if not exists submission_product_location text,
  add column if not exists submission_product_location_detail text,
  add column if not exists submission_all_kazakhstan boolean not null default false;

alter table requests drop constraint if exists requests_submission_ownership_form_valid;
alter table requests add constraint requests_submission_ownership_form_valid check (
  submission_ownership_form is null or submission_ownership_form in (
    'peasant_farm', 'llp_vat_agricultural_producer', 'llp_trader'
  )
);

alter table requests drop constraint if exists requests_submission_product_location_valid;
alter table requests add constraint requests_submission_product_location_valid check (
  submission_product_location is null or submission_product_location in ('elevator', 'seller_site')
);

alter table requests drop constraint if exists requests_submission_location_detail_not_blank;
alter table requests add constraint requests_submission_location_detail_not_blank check (
  submission_product_location_detail is null
  or (length(btrim(submission_product_location_detail)) between 1 and 200)
);

alter table requests drop constraint if exists requests_listing_submission_shape;
alter table requests add constraint requests_listing_submission_shape check (
  listing_submission_type is null
  or (
    listing_submission_type = 'product'
    and source = 'tab'
    and tab_type = 'product'
    and submission_category_name_snapshot is not null
    and submission_territory_code is not null
    and submission_ownership_form is not null
    and submission_product_location is not null
    and submission_all_kazakhstan = false
  )
  or (
    listing_submission_type = 'service'
    and source = 'tab'
    and tab_type = 'service'
    and submission_category_name_snapshot is not null
    and submission_territory_code is null
    and submission_ownership_form is null
    and submission_product_location is null
    and submission_product_location_detail is null
  )
) not valid;

create table if not exists request_service_territories (
  request_id uuid not null references requests (id) on delete cascade,
  territory_code text not null references territories (code),
  sort_order integer not null default 0,
  primary key (request_id, territory_code),
  constraint request_service_territories_sort_order_nonnegative check (sort_order >= 0),
  constraint request_service_territories_request_sort_unique unique (request_id, sort_order)
);

create or replace function set_card_version()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.version = old.version + 1;
  return new;
end;
$$;

drop trigger if exists set_cards_version on cards;
create trigger set_cards_version
before update on cards
for each row execute function set_card_version();

create index if not exists territories_kind_sort_order_idx
  on territories (kind, sort_order, name);

create index if not exists cards_published_product_territory_idx
  on cards (territory_code, sort_order, title, id)
  where type = 'product' and published_at is not null and archived_at is null;

create index if not exists card_service_territories_territory_card_idx
  on card_service_territories (territory_code, card_id);

create index if not exists request_service_territories_territory_request_idx
  on request_service_territories (territory_code, request_id);

create index if not exists requests_listing_submission_created_at_idx
  on requests (listing_submission_type, created_at desc)
  where listing_submission_type is not null;

alter table public.territories enable row level security;
alter table public.card_service_territories enable row level security;
alter table public.request_service_territories enable row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on public.territories from anon;
    revoke all on public.card_service_territories from anon;
    revoke all on public.request_service_territories from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on public.territories from authenticated;
    revoke all on public.card_service_territories from authenticated;
    revoke all on public.request_service_territories from authenticated;
  end if;
end;
$$;

commit;
