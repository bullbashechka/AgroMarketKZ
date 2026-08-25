-- Версия сессии позволяет отозвать все ранее выданные JWT конкретного пользователя.
alter table users
  add column if not exists token_version integer not null default 0;

alter table users
  drop constraint if exists users_token_version_nonnegative;

alter table users
  add constraint users_token_version_nonnegative check (token_version >= 0);
;
