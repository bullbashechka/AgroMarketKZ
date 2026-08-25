-- Release security foundation:
-- * one-time browser Widget proofs;
-- * transactional notification outbox for at-least-once Telegram delivery;
-- * private schema and client-role revocation for the new server-managed tables.
--
-- The Worker uses the privileged server connection for these tables. They are
-- deliberately outside the Supabase Data API surface and still have RLS as a
-- defence-in-depth control.

begin;

create schema if not exists app_private;
revoke all on schema app_private from public;
revoke create on schema public from public;

-- Close every application table, including the three tables introduced after
-- the original RLS migration. The backend remains the sole data path.
do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'users', 'categories', 'cards', 'card_images', 'card_specs', 'favorites',
    'requests', 'feedback_messages', 'platform_settings', 'territories',
    'card_service_territories', 'request_service_territories', 'card_update_mutations'
  ] loop
    if to_regclass('public.' || table_name) is not null then
      execute format('alter table public.%I enable row level security', table_name);
      execute format('revoke all on table public.%I from public', table_name);
      if exists (select 1 from pg_roles where rolname = 'anon') then
        execute format('revoke all on table public.%I from anon', table_name);
      end if;
      if exists (select 1 from pg_roles where rolname = 'authenticated') then
        execute format('revoke all on table public.%I from authenticated', table_name);
      end if;
    end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on all sequences in schema public from anon;
    revoke all on all functions in schema public from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on all sequences in schema public from authenticated;
    revoke all on all functions in schema public from authenticated;
  end if;
end
$$;

-- New objects must not silently become reachable through PostgREST. This
-- affects defaults owned by the current role; the supabase_admin block below
-- handles hosted projects where that owner is available to the runner.
alter default privileges in schema public revoke all on tables from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    alter default privileges in schema public revoke all on sequences from anon;
    alter default privileges in schema public revoke all on functions from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    alter default privileges in schema public revoke all on sequences from authenticated;
    alter default privileges in schema public revoke all on functions from authenticated;
  end if;
end
$$;

create table if not exists app_private.widget_auth_proofs (
  proof_hash text primary key,
  telegram_id bigint not null,
  auth_date timestamptz not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint widget_auth_proofs_hash_not_blank check (length(btrim(proof_hash)) > 0),
  constraint widget_auth_proofs_expiry_after_auth check (expires_at >= auth_date)
);

create index if not exists widget_auth_proofs_expiry_idx
  on app_private.widget_auth_proofs (expires_at);

create table if not exists app_private.notification_outbox (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  request_id uuid references public.requests (id) on delete cascade,
  feedback_id uuid references public.feedback_messages (id) on delete cascade,
  status text not null default 'pending',
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  processing_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  constraint notification_outbox_event_type_valid check (event_type in ('request', 'feedback')),
  constraint notification_outbox_status_valid check (status in ('pending', 'processing', 'sent', 'dead_letter')),
  constraint notification_outbox_attempts_nonnegative check (attempts >= 0),
  constraint notification_outbox_one_entity check (
    (event_type = 'request' and request_id is not null and feedback_id is null)
    or (event_type = 'feedback' and feedback_id is not null and request_id is null)
  )
);

create unique index if not exists notification_outbox_request_uidx
  on app_private.notification_outbox (request_id)
  where request_id is not null;

create unique index if not exists notification_outbox_feedback_uidx
  on app_private.notification_outbox (feedback_id)
  where feedback_id is not null;

create index if not exists notification_outbox_dispatch_idx
  on app_private.notification_outbox (status, next_attempt_at, created_at)
  where status in ('pending', 'processing');

alter table app_private.widget_auth_proofs enable row level security;
alter table app_private.notification_outbox enable row level security;

revoke all on all tables in schema app_private from public;
revoke all on all sequences in schema app_private from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on all tables in schema app_private from anon;
    revoke all on all sequences in schema app_private from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on all tables in schema app_private from authenticated;
    revoke all on all sequences in schema app_private from authenticated;
  end if;

  -- Supabase historically stores Data API defaults under supabase_admin.
  if exists (select 1 from pg_roles where rolname = 'supabase_admin') then
    if pg_has_role(current_user, 'supabase_admin', 'MEMBER') then
      execute 'alter default privileges for role supabase_admin in schema public revoke all on tables from public';
      execute 'alter default privileges for role supabase_admin in schema public revoke all on tables from anon';
      execute 'alter default privileges for role supabase_admin in schema public revoke all on tables from authenticated';
      execute 'alter default privileges for role supabase_admin in schema public revoke all on sequences from anon';
      execute 'alter default privileges for role supabase_admin in schema public revoke all on sequences from authenticated';
      execute 'alter default privileges for role supabase_admin in schema public revoke all on functions from anon';
      execute 'alter default privileges for role supabase_admin in schema public revoke all on functions from authenticated';
      execute 'alter default privileges for role supabase_admin in schema app_private revoke all on tables from anon';
      execute 'alter default privileges for role supabase_admin in schema app_private revoke all on tables from authenticated';
      execute 'alter default privileges for role supabase_admin in schema app_private revoke all on tables from public';
      execute 'alter default privileges for role supabase_admin in schema app_private revoke all on sequences from anon';
      execute 'alter default privileges for role supabase_admin in schema app_private revoke all on sequences from authenticated';
    else
      raise warning 'Could not revoke supabase_admin default privileges: current role is not a member';
    end if;
  end if;
end
$$;

-- Keep contrib extensions out of the exposed public schema where the hosted
-- role permits the move. Existing indexes continue to reference the extension
-- objects by OID; the warning path keeps the release migration non-blocking on
-- hosted projects that disallow changing the extension owner.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_trgm') then
    create schema if not exists extensions;
    begin
      execute 'alter extension pg_trgm set schema extensions';
    exception when others then
      raise warning 'pg_trgm remains in public: %', sqlerrm;
    end;
  end if;
end
$$;

commit;
