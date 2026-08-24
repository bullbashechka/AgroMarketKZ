-- Persist update receipts so a lost PUT response can be reconciled to the
-- exact mutation instead of trusting only a matching payload and version.

begin;

create table if not exists card_update_mutations (
  mutation_id uuid primary key,
  card_id uuid not null references cards (id) on delete cascade,
  expected_version integer not null,
  result_version integer not null,
  payload text not null,
  created_at timestamptz not null default now(),
  constraint card_update_mutations_expected_version_positive check (expected_version > 0),
  constraint card_update_mutations_result_version_positive check (result_version > 0),
  constraint card_update_mutations_payload_not_blank check (length(btrim(payload)) > 0)
);

create index if not exists card_update_mutations_card_idx
  on card_update_mutations (card_id, created_at desc);

alter table card_update_mutations enable row level security;

-- The backend uses the privileged database role. Keep the receipt table out of
-- the Supabase Data API even when project-level defaults expose new tables.
revoke all on table public.card_update_mutations from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on table public.card_update_mutations from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on table public.card_update_mutations from authenticated;
  end if;
end
$$;

commit;
