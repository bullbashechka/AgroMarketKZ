import type { CardListItem } from "@agromarket/contracts";
import type { Database } from "../db";
import type { AppEnv } from "../env";
import { HttpError } from "../lib/errors";
import { type CardListRow, toCardListItem } from "./catalog";

/** Добавляет карточку в избранное. 404, если карточки не существует. Идемпотентно. */
export async function addFavorite(env: AppEnv, userId: string, cardId: string, db: Database): Promise<void> {
  const sql = db.sql;
  const [card] = await sql<{ id: string }[]>`
    select id from cards
    where id = ${cardId} and published_at is not null and archived_at is null
  `;
  if (!card) {
    throw new HttpError(404, "Карточка не найдена");
  }
  await sql`
    insert into favorites (user_id, card_id)
    values (${userId}, ${cardId})
    on conflict (user_id, card_id) do nothing
  `;
}

/** Убирает карточку из избранного. Идемпотентно — отсутствие записи не ошибка. */
export async function removeFavorite(env: AppEnv, userId: string, cardId: string, db: Database): Promise<void> {
  const sql = db.sql;
  await sql`delete from favorites where user_id = ${userId} and card_id = ${cardId}`;
}

/** Список избранного пользователя (карточки-превью), новые сверху. Архив исключён. */
export async function listFavorites(env: AppEnv, userId: string, db: Database): Promise<CardListItem[]> {
  const sql = db.sql;
  const rows = await sql<CardListRow[]>`
    select
      c.id, c.type, c.category_id, c.title, c.price_type, c.price_amount,
      c.price_unit, c.location, c.availability, c.commodity_group, c.volume_tonnes,
      c.territory_code, territory.name as territory_name, territory.kind as territory_kind,
      territory.sort_order as territory_sort_order,
      c.ownership_form, c.product_location, c.service_all_kazakhstan,
      service.service_territories,
      img.storage_path as first_image_path,
      spec.key as first_spec_key, spec.value as first_spec_value
    from favorites f
    join cards c on c.id = f.card_id
    left join territories territory on territory.code = c.territory_code
    left join lateral (
      select coalesce(json_agg(json_build_object(
        'code', t.code, 'name', t.name, 'kind', t.kind, 'sort_order', t.sort_order
      ) order by cst.sort_order), '[]'::json) as service_territories
      from card_service_territories cst
      join territories t on t.code = cst.territory_code
      where cst.card_id = c.id
    ) service on true
    left join lateral (
      select storage_path from card_images where card_id = c.id order by sort_order limit 1
    ) img on true
    left join lateral (
      select key, value from card_specs where card_id = c.id order by sort_order limit 1
    ) spec on true
    where f.user_id = ${userId}
      and c.published_at is not null and c.archived_at is null
    order by f.created_at desc
  `;
  return rows.map((row) => toCardListItem(row, env));
}
