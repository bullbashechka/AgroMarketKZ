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
  'agromarketkz',
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
    'Семена и посадочный материал' as category_name
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
    'Удобрения и средства защиты'
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
    'Сельхозтехника'
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
    'Агрономические услуги'
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
    'Логистика и перевозки'
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
    'Ремонт техники'
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
