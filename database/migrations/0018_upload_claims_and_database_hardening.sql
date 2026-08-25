create table if not exists app_private.card_image_upload_claims (
  storage_path text primary key,
  issuer_user_id uuid not null references users(id) on delete cascade,
  content_type text not null check (content_type in ('image/jpeg', 'image/png', 'image/webp')),
  expires_at timestamptz not null,
  validated_at timestamptz,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint card_image_upload_claims_expiry check (expires_at > created_at)
);

create index concurrently if not exists requests_submission_category_id_idx
  on requests (submission_category_id);

create index concurrently if not exists requests_submission_territory_code_idx
  on requests (submission_territory_code);

alter table app_private.card_image_upload_claims enable row level security;
revoke all on table app_private.card_image_upload_claims from public;

do $block$
begin
  if exists (select 1 from pg_roles where rolname = 'agromarket_runtime') then
    grant select, insert, update, delete on table app_private.card_image_upload_claims to agromarket_runtime;
  end if;
end
$block$;
