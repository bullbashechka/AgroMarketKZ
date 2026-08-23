insert into platform_settings (
  id,
  contact_phone,
  whatsapp_phone,
  telegram_contact,
  email,
  admin_chat_id
) values (
  1,
  '+77000000000',
  '+77000000000',
  'https://t.me/agromarketkz',
  'hello@agromarket.kz',
  null
)
on conflict (id) do update set
  contact_phone = excluded.contact_phone,
  whatsapp_phone = excluded.whatsapp_phone,
  telegram_contact = excluded.telegram_contact,
  email = excluded.email;

insert into categories (type, name, sort_order) values
  ('product', 'Семена и посадочный материал', 10),
  ('product', 'Удобрения и средства защиты', 20),
  ('product', 'Сельхозтехника', 30),
  ('service', 'Агрономические услуги', 10),
  ('service', 'Логистика и перевозки', 20),
  ('service', 'Ремонт техники', 30)
on conflict do nothing;

with category_map as (
  select id, type, name
  from categories
  where (type, name) in (
    ('product', 'Семена и посадочный материал'),
    ('product', 'Удобрения и средства защиты'),
    ('product', 'Сельхозтехника'),
    ('service', 'Агрономические услуги'),
    ('service', 'Логистика и перевозки'),
    ('service', 'Ремонт техники')
  )
),
seed_cards as (
  select
    'product'::catalog_type as type,
    'Семена пшеницы Астана-2' as title,
    'Сортовые семена для весеннего сева, подходят для северных регионов Казахстана.' as description,
    'fixed'::price_type as price_type,
    120000 as price_amount,
    'за тонну' as price_unit,
    null::text as price_reason,
    'Северный Казахстан' as location,
    'В наличии' as availability,
    10 as sort_order,
    'Семена и посадочный материал' as category_name,
    'north_kazakhstan_region'::text as territory_code,
    'peasant_farm'::text as ownership_form,
    'elevator'::text as product_location,
    null::text as product_location_detail,
    false as service_all_kazakhstan
  union all
  select
    'product'::catalog_type,
    'Комплексное удобрение NPK',
    'Минеральное удобрение для зерновых и кормовых культур. Поставка мешками или биг-бэгами.',
    'from'::price_type,
    95000,
    'за тонну',
    'Зависит от объёма и формата поставки',
    'Казахстан',
    'Срок поставки по согласованию',
    20,
    'Удобрения и средства защиты',
    'akmola_region',
    'llp_vat_agricultural_producer',
    'seller_site',
    'Склад поставщика',
    false
  union all
  select
    'product'::catalog_type,
    'Б/у трактор 150 л.с.',
    'Трактор после технического обслуживания, готов к полевым работам.',
    'fixed'::price_type,
    8500000,
    'за штуку',
    null::text,
    'Костанайская область',
    'В наличии',
    30,
    'Сельхозтехника',
    'kostanay_region',
    'llp_trader',
    'seller_site',
    'База продавца',
    false
  union all
  select
    'service'::catalog_type,
    'Консультация агронома',
    'Подбор технологии выращивания, оценка состояния посевов и рекомендации по обработке.',
    'fixed'::price_type,
    25000,
    'за консультацию',
    null::text,
    'Казахстан',
    'Запись на ближайшую неделю',
    10,
    'Агрономические услуги',
    null,
    null,
    null,
    null,
    true
  union all
  select
    'service'::catalog_type,
    'Перевозка зерна по Казахстану',
    'Организация перевозки зерновых автотранспортом с подбором маршрута и тоннажа.',
    'on_request'::price_type,
    null::integer,
    'за рейс',
    'Зависит от маршрута, тоннажа и срока подачи транспорта',
    'По Казахстану',
    'Срок подачи по согласованию',
    20,
    'Логистика и перевозки',
    null,
    null,
    null,
    null,
    true
  union all
  select
    'service'::catalog_type,
    'Выездной ремонт сельхозтехники',
    'Диагностика и ремонт тракторов, комбайнов и навесного оборудования на месте.',
    'on_request'::price_type,
    null::integer,
    'за выезд',
    'Зависит от удалённости, модели техники и объёма ремонта',
    'По согласованию',
    'Выезд по записи',
    30,
    'Ремонт техники',
    null,
    null,
    null,
    null,
    false
)
insert into cards (
  type,
  category_id,
  title,
  description,
  price_type,
  price_amount,
  price_unit,
  price_reason,
  location,
  availability,
  territory_code,
  ownership_form,
  product_location,
  product_location_detail,
  service_all_kazakhstan,
  published_at,
  sort_order
)
select
  seed_cards.type,
  category_map.id,
  seed_cards.title,
  seed_cards.description,
  seed_cards.price_type,
  seed_cards.price_amount,
  seed_cards.price_unit,
  seed_cards.price_reason,
  seed_cards.location,
  seed_cards.availability,
  seed_cards.territory_code,
  seed_cards.ownership_form,
  seed_cards.product_location,
  seed_cards.product_location_detail,
  seed_cards.service_all_kazakhstan,
  now(),
  seed_cards.sort_order
from seed_cards
join category_map
  on category_map.type = seed_cards.type
  and category_map.name = seed_cards.category_name
where not exists (
  select 1
  from cards
  where cards.type = seed_cards.type
    and lower(btrim(cards.title)) = lower(btrim(seed_cards.title))
);

-- Повторный dev-seed обновляет уже существующие демонстрационные карточки,
-- чтобы они не остались legacy после применения миграции 0011.
update cards as c
set
  territory_code = seed.territory_code,
  ownership_form = seed.ownership_form,
  product_location = seed.product_location,
  product_location_detail = seed.product_location_detail,
  service_all_kazakhstan = seed.service_all_kazakhstan
from (
  values
    ('product'::catalog_type, 'Семена пшеницы Астана-2', 'north_kazakhstan_region', 'peasant_farm', 'elevator', null::text, false),
    ('product'::catalog_type, 'Комплексное удобрение NPK', 'akmola_region', 'llp_vat_agricultural_producer', 'seller_site', 'Склад поставщика', false),
    ('product'::catalog_type, 'Б/у трактор 150 л.с.', 'kostanay_region', 'llp_trader', 'seller_site', 'База продавца', false),
    ('service'::catalog_type, 'Консультация агронома', null::text, null::text, null::text, null::text, true),
    ('service'::catalog_type, 'Перевозка зерна по Казахстану', null::text, null::text, null::text, null::text, true),
    ('service'::catalog_type, 'Выездной ремонт сельхозтехники', null::text, null::text, null::text, null::text, false)
) as seed(type, title, territory_code, ownership_form, product_location, product_location_detail, service_all_kazakhstan)
where c.type = seed.type
  and lower(btrim(c.title)) = lower(btrim(seed.title));

with service_territory_seed as (
  select 'Выездной ремонт сельхозтехники' as card_title, 'kostanay_region'::text as territory_code, 0 as sort_order
  union all select 'Выездной ремонт сельхозтехники', 'akmola_region', 1
)
insert into card_service_territories (card_id, territory_code, sort_order)
select cards.id, service_territory_seed.territory_code, service_territory_seed.sort_order
from service_territory_seed
join cards on cards.type = 'service' and cards.title = service_territory_seed.card_title
on conflict (card_id, territory_code) do nothing;

with spec_seed as (
  select 'Семена пшеницы Астана-2' as card_title, 'Регион' as key, 'Северный Казахстан' as value, 10 as sort_order
  union all select 'Семена пшеницы Астана-2', 'Фасовка', 'мешок 50 кг', 20
  union all select 'Комплексное удобрение NPK', 'Формат поставки', 'мешки / биг-бэги', 10
  union all select 'Б/у трактор 150 л.с.', 'Мощность', '150 л.с.', 10
  union all select 'Б/у трактор 150 л.с.', 'Состояние', 'после ТО', 20
  union all select 'Консультация агронома', 'Формат', 'онлайн / выезд', 10
  union all select 'Перевозка зерна по Казахстану', 'География', 'Казахстан', 10
  union all select 'Выездной ремонт сельхозтехники', 'Выезд', 'по согласованию', 10
)
insert into card_specs (card_id, key, value, sort_order)
select
  cards.id,
  spec_seed.key,
  spec_seed.value,
  spec_seed.sort_order
from spec_seed
join cards on cards.title = spec_seed.card_title
on conflict do nothing;
