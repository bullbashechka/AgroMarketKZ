-- Security hardening: remember a short-lived Telegram identity cutoff so a
-- signed Mini App proof cannot mint a new account after full revocation or
-- account deletion.

create table if not exists app_private.telegram_auth_cutoffs (
  identity_hash text primary key,
  auth_not_before bigint not null,
  expires_at timestamptz not null,
  updated_at timestamptz not null default now(),
  constraint telegram_auth_cutoffs_hash_not_blank check (length(btrim(identity_hash)) = 64),
  constraint telegram_auth_cutoffs_auth_not_before_positive check (auth_not_before > 0),
  constraint telegram_auth_cutoffs_expiry_after_update check (expires_at > updated_at)
);

create index if not exists telegram_auth_cutoffs_expiry_idx
  on app_private.telegram_auth_cutoffs (expires_at);

alter table app_private.telegram_auth_cutoffs enable row level security;
revoke all on table app_private.telegram_auth_cutoffs from public;

do $block$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on table app_private.telegram_auth_cutoffs from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on table app_private.telegram_auth_cutoffs from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'agromarket_runtime') then
    grant select, insert, update, delete on table app_private.telegram_auth_cutoffs to agromarket_runtime;
  end if;
end
$block$;

-- A legal hold is meaningful only for a live account. The trigger takes a
-- KEY SHARE lock on the parent row, which serializes a hold INSERT with
-- deleteAccount()'s FOR UPDATE and rechecks deleted_at after either side wins.
create or replace function app_private.assert_privacy_hold_user_live()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  user_deleted_at timestamptz;
begin
  select u.deleted_at
    into user_deleted_at
  from public.users as u
  where u.id = new.user_id
  for key share;

  if not found or user_deleted_at is not null then
    raise exception using
      errcode = '23514',
      message = 'privacy hold requires a live user';
  end if;
  return new;
end
$function$;

drop trigger if exists privacy_holds_require_live_user on app_private.privacy_holds;
create trigger privacy_holds_require_live_user
  before insert or update of user_id on app_private.privacy_holds
  for each row execute function app_private.assert_privacy_hold_user_live();
