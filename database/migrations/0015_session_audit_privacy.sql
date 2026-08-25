-- Security hardening: opaque sessions, append-only administrator audit trail
-- and the minimum persistence needed for privacy retention/deletion.

create table if not exists app_private.user_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  rotated_at timestamptz,
  replacement_session_id uuid references app_private.user_sessions (id),
  grace_expires_at timestamptz,
  revoked_at timestamptz,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint user_sessions_token_hash_not_blank check (length(btrim(token_hash)) = 64),
  constraint user_sessions_expiry_after_creation check (expires_at > created_at),
  constraint user_sessions_rotation_shape check (
    (replacement_session_id is null and grace_expires_at is null and rotated_at is null)
    or (replacement_session_id is not null and grace_expires_at is not null and rotated_at is not null)
  )
);

create index if not exists user_sessions_user_active_idx
  on app_private.user_sessions (user_id, expires_at)
  where revoked_at is null;

create table if not exists app_private.admin_audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid not null references public.users (id) on delete restrict,
  actor_telegram_id bigint not null,
  request_id uuid not null,
  action text not null,
  target_type text not null,
  target_id text,
  outcome text not null default 'success',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint admin_audit_events_action_not_blank check (length(btrim(action)) > 0),
  constraint admin_audit_events_target_type_not_blank check (length(btrim(target_type)) > 0),
  constraint admin_audit_events_outcome_valid check (outcome in ('success', 'denied', 'failed')),
  constraint admin_audit_events_metadata_object check (jsonb_typeof(metadata) = 'object')
);

create index if not exists admin_audit_events_actor_created_idx
  on app_private.admin_audit_events (actor_telegram_id, created_at desc);
create index if not exists admin_audit_events_created_idx
  on app_private.admin_audit_events (created_at);

alter table public.users
  add column if not exists last_seen_at timestamptz not null default now(),
  add column if not exists deletion_requested_at timestamptz,
  add column if not exists deleted_at timestamptz;

create table if not exists app_private.privacy_holds (
  user_id uuid primary key references public.users (id) on delete cascade,
  reason text not null,
  created_at timestamptz not null default now(),
  constraint privacy_holds_reason_not_blank check (length(btrim(reason)) > 0)
);

alter table app_private.user_sessions enable row level security;
alter table app_private.admin_audit_events enable row level security;
alter table app_private.privacy_holds enable row level security;

revoke all on table app_private.user_sessions from public;
revoke all on table app_private.admin_audit_events from public;
revoke all on table app_private.privacy_holds from public;

-- Runtime receives only the capabilities it needs. The audit table remains
-- append-only even for the Worker role; retention is an operator migration task.
do $block$
begin
  if exists (select 1 from pg_roles where rolname = 'agromarket_runtime') then
    grant select, insert, update on table app_private.user_sessions to agromarket_runtime;
    grant insert on table app_private.admin_audit_events to agromarket_runtime;
    grant select on table app_private.privacy_holds to agromarket_runtime;
  end if;
end
$block$;
