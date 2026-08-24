-- Поля товарного каталога: группа продукции, объём, форма фильтрации и признак
-- товарной категории. Старые опубликованные товары скрываются до ручного
-- заполнения новых обязательных полей; данные карточек и заявок не удаляются.

begin;

alter table categories
  add column if not exists is_commodity boolean not null default false;

alter table cards
  add column if not exists commodity_group text,
  add column if not exists volume_tonnes numeric(14,3);

alter table requests
  add column if not exists submission_commodity_group text,
  add column if not exists submission_volume_tonnes numeric(14,3);

-- Товарные карточки требуют ручного backfill. Сервисы и архивные товары не
-- затрагиваются; избранное и связанные заявки остаются на тех же UUID.
update cards
set published_at = null
where type = 'product'
  and published_at is not null
  and archived_at is null;

-- «Наличие» больше не является полем товара: очищаем его и у черновиков,
-- чтобы старое значение не вернулось в карточку после повторного сохранения.
update cards
set availability = null
where type = 'product';

alter table categories drop constraint if exists categories_commodity_type;
alter table categories add constraint categories_commodity_type check (
  type = 'product' or is_commodity = false
) not valid;

alter table cards drop constraint if exists cards_commodity_group_valid;
alter table cards add constraint cards_commodity_group_valid check (
  commodity_group is null or commodity_group in ('cereals', 'oilseeds', 'pulses')
) not valid;

alter table cards drop constraint if exists cards_volume_tonnes_valid;
alter table cards add constraint cards_volume_tonnes_valid check (
  volume_tonnes is null or (volume_tonnes > 0 and volume_tonnes <= 99999999999.999)
) not valid;

alter table cards drop constraint if exists cards_commodity_fields_shape;
alter table cards add constraint cards_commodity_fields_shape check (
  (type = 'service' and commodity_group is null and volume_tonnes is null)
  or
  (type = 'product' and ((commodity_group is null and volume_tonnes is null)
    or (commodity_group is not null and volume_tonnes is not null)))
) not valid;

alter table cards drop constraint if exists cards_product_territory_region;
alter table cards add constraint cards_product_territory_region check (
  territory_code is null or territory_code in (
    'abay_region', 'akmola_region', 'aktobe_region', 'almaty_region',
    'atyrau_region', 'east_kazakhstan_region', 'zhambyl_region',
    'zhetysu_region', 'west_kazakhstan_region', 'karaganda_region',
    'kostanay_region', 'kyzylorda_region', 'mangystau_region',
    'pavlodar_region', 'north_kazakhstan_region', 'turkistan_region',
    'ulytau_region'
  )
) not valid;

-- Для товара «по запросу» больше нет: цена всегда числовая. Услуга по-прежнему
-- может быть без суммы при заполненном пояснении.
alter table cards drop constraint if exists cards_published_price_complete;
alter table cards add constraint cards_published_price_complete check (
  published_at is null
  or archived_at is not null
  or (
    price_unit is not null
    and length(btrim(price_unit)) > 0
    and (
      (type = 'product' and price_type in ('fixed', 'from') and price_amount is not null and price_amount > 0)
      or
      (type = 'service' and (
        (price_type in ('fixed', 'from') and price_amount is not null and price_amount > 0)
        or (price_type = 'on_request' and price_amount is null and price_reason is not null
          and length(btrim(price_reason)) > 0)
      ))
    )
  )
) not valid;

-- Для всех опубликованных товаров обязательны область, форма собственности и
-- местонахождение. Группа и объём commodity-категории проверяются приложением,
-- поскольку SQL CHECK не может безопасно ссылаться на связанную categories.
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

alter table requests drop constraint if exists requests_submission_commodity_group_valid;
alter table requests add constraint requests_submission_commodity_group_valid check (
  submission_commodity_group is null
  or submission_commodity_group in ('cereals', 'oilseeds', 'pulses')
) not valid;

alter table requests drop constraint if exists requests_submission_volume_tonnes_valid;
alter table requests add constraint requests_submission_volume_tonnes_valid check (
  submission_volume_tonnes is null
  or (submission_volume_tonnes > 0 and submission_volume_tonnes <= 99999999999.999)
) not valid;

alter table requests drop constraint if exists requests_submission_product_territory_region;
alter table requests add constraint requests_submission_product_territory_region check (
  submission_territory_code is null or submission_territory_code in (
    'abay_region', 'akmola_region', 'aktobe_region', 'almaty_region',
    'atyrau_region', 'east_kazakhstan_region', 'zhambyl_region',
    'zhetysu_region', 'west_kazakhstan_region', 'karaganda_region',
    'kostanay_region', 'kyzylorda_region', 'mangystau_region',
    'pavlodar_region', 'north_kazakhstan_region', 'turkistan_region',
    'ulytau_region'
  )
) not valid;

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
    and ((submission_commodity_group is null and submission_volume_tonnes is null)
      or (submission_commodity_group is not null and submission_volume_tonnes is not null))
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
    and submission_commodity_group is null
    and submission_volume_tonnes is null
  )
) not valid;

create index if not exists cards_published_product_group_idx
  on cards (commodity_group, sort_order, title, id)
  where type = 'product' and published_at is not null and archived_at is null;

create index if not exists cards_published_product_volume_idx
  on cards (volume_tonnes, sort_order, title, id)
  where type = 'product' and published_at is not null and archived_at is null
    and volume_tonnes is not null;

commit;
