-- Подтверждение телефона через Telegram requestContact (Этап 8).
-- users.verified_phone — номер (E.164), подтверждённый подписанным контактом Telegram;
-- «телефон подтверждён» — производное сравнение contact_phone = verified_phone.
-- В заявках и обратной связи флаг снапшотится в момент создания: телефон в форме
-- мог отличаться от профиля или быть отредактированным позже.

alter table users
  add column if not exists verified_phone text;

do $$
begin
  alter table users
    add constraint users_verified_phone_not_blank
      check (verified_phone is null or length(btrim(verified_phone)) > 0);
exception
  when duplicate_object then null;
end $$;

alter table requests
  add column if not exists contact_phone_verified boolean not null default false;

alter table feedback_messages
  add column if not exists contact_phone_verified boolean not null default false;
