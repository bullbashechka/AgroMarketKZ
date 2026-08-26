-- Durable transactional intent and recovery state for administrator audit
-- events. The final audit table remains append-only; this table only holds
-- mutable delivery state until the event has been inserted there.

-- Physical retention may remove an unregistered user while the audit history
-- must survive. The immutable Telegram-id snapshot remains in the audit row;
-- the relational user link is nullable and is cleared on user deletion.
alter table app_private.admin_audit_events
  alter column actor_user_id drop not null;

alter table app_private.admin_audit_events
  drop constraint if exists admin_audit_events_actor_user_id_fkey;

alter table app_private.admin_audit_events
  add constraint admin_audit_events_actor_user_id_fkey
  foreign key (actor_user_id) references public.users (id) on delete set null;

create index if not exists admin_audit_events_actor_user_id_idx
  on app_private.admin_audit_events (actor_user_id, created_at desc);

alter table app_private.notification_outbox
  add column if not exists processing_token uuid;

create index if not exists notification_outbox_processing_idx
  on app_private.notification_outbox (status, processing_at, created_at)
  where status = 'processing';

create table if not exists app_private.admin_audit_outbox (
  id uuid primary key,
  actor_user_id uuid references public.users (id) on delete set null,
  actor_telegram_id bigint not null,
  request_id uuid not null,
  action text not null,
  target_type text not null,
  target_id text,
  outcome text not null,
  metadata jsonb not null default '{}'::jsonb,
  status text not null default 'pending',
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  processing_at timestamptz,
  processing_token uuid,
  last_error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  dead_lettered_at timestamptz,
  constraint admin_audit_outbox_action_not_blank check (length(btrim(action)) > 0),
  constraint admin_audit_outbox_target_type_not_blank check (length(btrim(target_type)) > 0),
  constraint admin_audit_outbox_outcome_valid check (outcome in ('success', 'denied', 'failed')),
  constraint admin_audit_outbox_metadata_object check (jsonb_typeof(metadata) = 'object'),
  constraint admin_audit_outbox_status_valid check (status in ('pending', 'processing', 'sent', 'dead_letter')),
  constraint admin_audit_outbox_attempts_bounded check (attempts between 0 and 20)
);

-- Keep the migration safe if a local rehearsal created the table with an
-- earlier draft of this migration.
alter table app_private.admin_audit_outbox
  alter column actor_user_id drop not null,
  add column if not exists processing_token uuid,
  add column if not exists dead_lettered_at timestamptz;

alter table app_private.admin_audit_outbox
  drop constraint if exists admin_audit_outbox_actor_user_id_fkey,
  drop constraint if exists admin_audit_outbox_status_valid,
  drop constraint if exists admin_audit_outbox_attempts_nonnegative,
  drop constraint if exists admin_audit_outbox_attempts_bounded;

alter table app_private.admin_audit_outbox
  add constraint admin_audit_outbox_actor_user_id_fkey
    foreign key (actor_user_id) references public.users (id) on delete set null,
  add constraint admin_audit_outbox_status_valid
    check (status in ('pending', 'processing', 'sent', 'dead_letter')),
  add constraint admin_audit_outbox_attempts_bounded
    check (attempts between 0 and 20);

create index if not exists admin_audit_outbox_dispatch_idx
  on app_private.admin_audit_outbox (status, next_attempt_at, created_at)
  where status in ('pending', 'processing');

create index if not exists admin_audit_outbox_processing_idx
  on app_private.admin_audit_outbox (status, processing_at, created_at)
  where status = 'processing';

create index if not exists admin_audit_outbox_actor_user_id_idx
  on app_private.admin_audit_outbox (actor_user_id, created_at desc);

alter table app_private.admin_audit_outbox enable row level security;
revoke all on table app_private.admin_audit_outbox from public;

do $block$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on table app_private.admin_audit_outbox from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on table app_private.admin_audit_outbox from authenticated;
  end if;
end
$block$;

-- The runtime may advance delivery state, but it cannot update or delete the
-- append-only final audit rows. The outbox itself is not the audit history.
do $block$
begin
  if exists (select 1 from pg_roles where rolname = 'agromarket_runtime') then
    grant insert on table app_private.admin_audit_events to agromarket_runtime;
    grant select, insert, update on table app_private.notification_outbox to agromarket_runtime;
    grant select, insert, update on table app_private.admin_audit_outbox to agromarket_runtime;
  end if;
end
$block$;
