create extension if not exists pgcrypto;

do $$
begin
  create type catalog_type as enum ('product', 'service');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type price_type as enum ('fixed', 'on_request');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type request_source as enum ('card', 'tab', 'profile');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type request_status as enum ('new', 'in_progress', 'closed');
exception
  when duplicate_object then null;
end $$;

create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  telegram_id bigint not null unique,
  telegram_username text,
  telegram_first_name text,
  telegram_last_name text,
  contact_name text,
  contact_phone text,
  registered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint users_contact_name_not_blank check (contact_name is null or length(btrim(contact_name)) > 0),
  constraint users_contact_phone_not_blank check (contact_phone is null or length(btrim(contact_phone)) > 0),
  constraint users_registered_has_contacts check (
    registered_at is null or (contact_name is not null and contact_phone is not null)
  )
);

create table if not exists categories (
  id uuid primary key default gen_random_uuid(),
  type catalog_type not null,
  name text not null,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint categories_name_not_blank check (length(btrim(name)) > 0),
  constraint categories_id_type_unique unique (id, type)
);

create table if not exists cards (
  id uuid primary key default gen_random_uuid(),
  type catalog_type not null,
  category_id uuid not null,
  title text not null,
  description text not null default '',
  price_type price_type not null,
  price_amount integer,
  sort_order integer not null default 0,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cards_category_type_fkey foreign key (category_id, type)
    references categories (id, type)
    on update cascade
    on delete restrict,
  constraint cards_title_not_blank check (length(btrim(title)) > 0),
  constraint cards_valid_price check (
    (price_type = 'fixed' and price_amount is not null and price_amount > 0)
    or
    (price_type = 'on_request' and price_amount is null)
  )
);

create table if not exists card_images (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references cards (id) on delete cascade,
  storage_path text not null,
  alt_text text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  constraint card_images_storage_path_not_blank check (length(btrim(storage_path)) > 0),
  constraint card_images_alt_text_not_blank check (alt_text is null or length(btrim(alt_text)) > 0),
  constraint card_images_card_path_unique unique (card_id, storage_path)
);

create table if not exists card_specs (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references cards (id) on delete cascade,
  key text not null,
  value text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint card_specs_key_not_blank check (length(btrim(key)) > 0),
  constraint card_specs_value_not_blank check (length(btrim(value)) > 0)
);

create table if not exists favorites (
  user_id uuid not null references users (id) on delete cascade,
  card_id uuid not null references cards (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, card_id)
);

create table if not exists requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete restrict,
  source request_source not null,
  card_id uuid references cards (id) on delete restrict,
  tab_type catalog_type,
  card_title_snapshot text,
  card_price_type_snapshot price_type,
  card_price_amount_snapshot integer,
  contact_name text not null,
  contact_phone text not null,
  comment text,
  status request_status not null default 'new',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint requests_contact_name_not_blank check (length(btrim(contact_name)) > 0),
  constraint requests_contact_phone_not_blank check (length(btrim(contact_phone)) > 0),
  constraint requests_comment_not_blank check (comment is null or length(btrim(comment)) > 0),
  constraint requests_card_title_snapshot_not_blank check (
    card_title_snapshot is null or length(btrim(card_title_snapshot)) > 0
  ),
  constraint requests_source_shape check (
    (
      source = 'card'
      and card_id is not null
      and tab_type is null
      and card_title_snapshot is not null
      and card_price_type_snapshot is not null
    )
    or
    (
      source = 'tab'
      and card_id is null
      and tab_type is not null
      and card_title_snapshot is null
      and card_price_type_snapshot is null
      and card_price_amount_snapshot is null
    )
    or
    (
      source = 'profile'
      and card_id is null
      and tab_type is null
      and card_title_snapshot is null
      and card_price_type_snapshot is null
      and card_price_amount_snapshot is null
    )
  ),
  constraint requests_valid_card_price_snapshot check (
    source <> 'card'
    or
    (
      (card_price_type_snapshot = 'fixed' and card_price_amount_snapshot is not null and card_price_amount_snapshot > 0)
      or
      (card_price_type_snapshot = 'on_request' and card_price_amount_snapshot is null)
    )
  )
);

create table if not exists feedback_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete restrict,
  contact_name text not null,
  contact_phone text not null,
  message text not null,
  created_at timestamptz not null default now(),
  constraint feedback_messages_contact_name_not_blank check (length(btrim(contact_name)) > 0),
  constraint feedback_messages_contact_phone_not_blank check (length(btrim(contact_phone)) > 0),
  constraint feedback_messages_message_not_blank check (length(btrim(message)) > 0)
);

create table if not exists platform_settings (
  id integer primary key default 1,
  contact_phone text,
  whatsapp_phone text,
  telegram_contact text,
  email text,
  admin_chat_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint platform_settings_single_row check (id = 1),
  constraint platform_settings_contact_phone_not_blank check (contact_phone is null or length(btrim(contact_phone)) > 0),
  constraint platform_settings_whatsapp_phone_not_blank check (whatsapp_phone is null or length(btrim(whatsapp_phone)) > 0),
  constraint platform_settings_telegram_contact_not_blank check (telegram_contact is null or length(btrim(telegram_contact)) > 0),
  constraint platform_settings_email_not_blank check (email is null or length(btrim(email)) > 0),
  constraint platform_settings_admin_chat_id_not_blank check (admin_chat_id is null or length(btrim(admin_chat_id)) > 0)
);

create unique index if not exists categories_active_type_name_uidx
  on categories (type, btrim(name))
  where is_active;

create index if not exists categories_type_sort_order_idx
  on categories (type, sort_order, name)
  where is_active;

create index if not exists cards_active_catalog_idx
  on cards (type, category_id, sort_order, title)
  where archived_at is null;

create index if not exists cards_category_id_idx
  on cards (category_id);

create index if not exists cards_type_title_idx
  on cards (type, btrim(title))
  where archived_at is null;

create index if not exists card_images_card_id_sort_order_idx
  on card_images (card_id, sort_order);

create index if not exists card_specs_card_id_sort_order_idx
  on card_specs (card_id, sort_order);

create unique index if not exists card_specs_card_key_uidx
  on card_specs (card_id, btrim(key));

create index if not exists favorites_user_id_created_at_idx
  on favorites (user_id, created_at desc);

create index if not exists favorites_card_id_idx
  on favorites (card_id);

create index if not exists requests_user_id_created_at_idx
  on requests (user_id, created_at desc);

create index if not exists requests_card_id_idx
  on requests (card_id);

create index if not exists requests_status_created_at_idx
  on requests (status, created_at desc);

create index if not exists feedback_messages_user_id_created_at_idx
  on feedback_messages (user_id, created_at desc);

create index if not exists feedback_messages_created_at_idx
  on feedback_messages (created_at desc);

create index if not exists users_created_at_idx
  on users (created_at desc);

drop trigger if exists set_users_updated_at on users;
create trigger set_users_updated_at
before update on users
for each row execute function set_updated_at();

drop trigger if exists set_categories_updated_at on categories;
create trigger set_categories_updated_at
before update on categories
for each row execute function set_updated_at();

drop trigger if exists set_cards_updated_at on cards;
create trigger set_cards_updated_at
before update on cards
for each row execute function set_updated_at();

drop trigger if exists set_card_specs_updated_at on card_specs;
create trigger set_card_specs_updated_at
before update on card_specs
for each row execute function set_updated_at();

drop trigger if exists set_requests_updated_at on requests;
create trigger set_requests_updated_at
before update on requests
for each row execute function set_updated_at();

drop trigger if exists set_platform_settings_updated_at on platform_settings;
create trigger set_platform_settings_updated_at
before update on platform_settings
for each row execute function set_updated_at();

comment on table card_images is 'Images are stored in the Supabase Storage bucket named card-images. This table stores storage paths, not public URLs.';
;
