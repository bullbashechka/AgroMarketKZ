-- PII-free progress markers for resumable scheduled maintenance jobs.
-- They store only job names and opaque cursors/outcomes, never object bodies,
-- user identifiers, phones, tokens, or Telegram data.

create table if not exists app_private.maintenance_checkpoints (
  job_name text primary key,
  checkpoint jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  constraint maintenance_checkpoints_job_name_not_blank check (length(btrim(job_name)) > 0),
  constraint maintenance_checkpoints_checkpoint_object check (jsonb_typeof(checkpoint) = 'object')
);

alter table app_private.maintenance_checkpoints enable row level security;
revoke all on table app_private.maintenance_checkpoints from public;

do $block$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on table app_private.maintenance_checkpoints from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on table app_private.maintenance_checkpoints from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'agromarket_runtime') then
    grant select, insert, update on table app_private.maintenance_checkpoints to agromarket_runtime;
  end if;
end
$block$;
