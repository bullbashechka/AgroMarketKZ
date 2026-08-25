create table if not exists app_private.telegram_updates (
  update_id bigint primary key,
  action jsonb not null,
  status text not null default 'pending',
  attempts integer not null default 0,
  last_error text,
  processing_started_at timestamptz,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint telegram_updates_status_valid check (status in ('pending', 'processing', 'processed', 'dead_letter')),
  constraint telegram_updates_action_object check (jsonb_typeof(action) = 'object')
);

create index if not exists telegram_updates_pending_idx
  on app_private.telegram_updates (status, created_at)
  where status in ('pending', 'processing');

create table if not exists app_private.telegram_start_cooldowns (
  chat_id bigint primary key,
  next_allowed_at timestamptz not null
);

alter table app_private.telegram_updates enable row level security;
alter table app_private.telegram_start_cooldowns enable row level security;
revoke all on table app_private.telegram_updates from public;
revoke all on table app_private.telegram_start_cooldowns from public;

do $block$
begin
  if exists (select 1 from pg_roles where rolname = 'agromarket_runtime') then
    grant select, insert, update, delete on table app_private.telegram_updates to agromarket_runtime;
    grant select, insert, update on table app_private.telegram_start_cooldowns to agromarket_runtime;
  end if;
end
$block$;
