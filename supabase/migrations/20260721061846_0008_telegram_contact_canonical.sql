with normalized as (
  select
    id,
    regexp_replace(regexp_replace(btrim(telegram_contact), '^(https?://)?(www\.)?t\.me/', '', 'i'), '^@', '') as handle
  from platform_settings
  where telegram_contact is not null
)
update platform_settings ps
set telegram_contact = case
  when n.handle ~ '^[A-Za-z][A-Za-z0-9_]{4,31}$' then 'https://t.me/' || n.handle
  else null
end
from normalized n
where ps.id = n.id;

alter table platform_settings drop constraint if exists platform_settings_telegram_contact_canonical;
alter table platform_settings
  add constraint platform_settings_telegram_contact_canonical check (
    telegram_contact is null or telegram_contact ~ '^https://t\.me/[A-Za-z][A-Za-z0-9_]{4,31}$'
  );;
