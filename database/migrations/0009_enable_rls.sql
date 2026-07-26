-- Закрывает прямой доступ Data API к прикладным таблицам: backend подключается
-- привилегированной ролью postgres и продолжает работать через прямое соединение.
-- Схему storage намеренно не трогаем: каталог читает фото прямыми GET из публичного bucket.

begin;

alter table public.users enable row level security;
alter table public.categories enable row level security;
alter table public.cards enable row level security;
alter table public.card_images enable row level security;
alter table public.card_specs enable row level security;
alter table public.favorites enable row level security;
alter table public.requests enable row level security;
alter table public.feedback_messages enable row level security;
alter table public.platform_settings enable row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on all tables in schema public from anon;
    revoke all on all sequences in schema public from anon;
    revoke all on all functions in schema public from anon;
    alter default privileges in schema public revoke all on tables from anon;
    alter default privileges in schema public revoke all on sequences from anon;
    alter default privileges in schema public revoke all on functions from anon;
  end if;

  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on all tables in schema public from authenticated;
    revoke all on all sequences in schema public from authenticated;
    revoke all on all functions in schema public from authenticated;
    alter default privileges in schema public revoke all on tables from authenticated;
    alter default privileges in schema public revoke all on sequences from authenticated;
    alter default privileges in schema public revoke all on functions from authenticated;
  end if;

  -- Supabase historically grants Data API defaults as supabase_admin, not postgres.
  -- ALTER DEFAULT PRIVILEGES without FOR ROLE changes only the current role's defaults.
  if exists (select 1 from pg_roles where rolname = 'supabase_admin')
    and pg_has_role(current_user, 'supabase_admin', 'MEMBER')
  then
    execute 'alter default privileges for role supabase_admin in schema public revoke all on tables from anon';
    execute 'alter default privileges for role supabase_admin in schema public revoke all on sequences from anon';
    execute 'alter default privileges for role supabase_admin in schema public revoke all on functions from anon';
    execute 'alter default privileges for role supabase_admin in schema public revoke all on tables from authenticated';
    execute 'alter default privileges for role supabase_admin in schema public revoke all on sequences from authenticated';
    execute 'alter default privileges for role supabase_admin in schema public revoke all on functions from authenticated';
  elsif exists (select 1 from pg_roles where rolname = 'supabase_admin') then
    raise warning 'Cannot change supabase_admin default privileges as role %. Disable automatic exposure of new tables in Supabase Data API settings.', current_user;
  end if;
end
$$;

commit;
