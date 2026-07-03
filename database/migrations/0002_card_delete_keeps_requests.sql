-- Позволяет удалять карточку, по которой уже есть заявки: заявка хранит
-- снапшот названия/цены и не должна блокировать удаление карточки админом.
alter table requests
  drop constraint requests_card_id_fkey;

alter table requests
  add constraint requests_card_id_fkey foreign key (card_id)
    references cards (id)
    on delete set null;

alter table requests
  drop constraint requests_source_shape;

alter table requests
  add constraint requests_source_shape check (
    (
      source = 'card'
      and tab_type is null
      and card_title_snapshot is not null
      and card_price_type_snapshot is not null
    )
    or
    (
      source = 'tab'
      and card_id is null
      and tab_type is not null
      and card_title_snapshot is null
      and card_price_type_snapshot is null
      and card_price_amount_snapshot is null
    )
    or
    (
      source = 'profile'
      and card_id is null
      and tab_type is null
      and card_title_snapshot is null
      and card_price_type_snapshot is null
      and card_price_amount_snapshot is null
    )
  );
