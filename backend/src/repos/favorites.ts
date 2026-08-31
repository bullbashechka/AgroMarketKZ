import type { FavoriteMembershipQuery, FavoritesPageQuery, FavoritesResponse } from "@agromarket/contracts";
import type { Database } from "../db";
import type { AppEnv } from "../env";
import { HttpError } from "../lib/errors";
import { type CardListRow, toCardListItem } from "./catalog";

type FavoriteCursor = { createdAt: string; cardId: string };
type FavoriteCardListRow = CardListRow & { favorite_created_at: string };

function encodeCursor(cursor: FavoriteCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

function decodeCursor(cursor: string | undefined): FavoriteCursor | null {
  if (!cursor) return null;
  try {
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as Partial<FavoriteCursor>;
    if (typeof value.createdAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(value.createdAt) || Number.isNaN(Date.parse(value.createdAt)) || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.cardId ?? "")) {
      throw new Error("invalid cursor");
    }
    return { createdAt: value.createdAt, cardId: value.cardId! };
  } catch {
    throw new HttpError(400, "Некорректный курсор избранного");
  }
}

export async function listFavoriteIds(userId: string, { cardIds }: FavoriteMembershipQuery, db: Database): Promise<string[]> {
  const rows = await db.sql<{ card_id: string }[]>`
    select card_id from favorites where user_id = ${userId} and card_id = any(${cardIds}::uuid[])
  `;
  return rows.map((row) => row.card_id);
}

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

/** Bounded keyset page избранного, новые сверху; видимость совпадает с public catalog. */
export async function listFavorites(env: AppEnv, userId: string, page: FavoritesPageQuery, db: Database): Promise<FavoritesResponse> {
  const sql = db.sql;
  const cursor = decodeCursor(page.cursor);
  const limit = page.limit + 1;
  const select = await (cursor ? sql<FavoriteCardListRow[]>`
    select
      to_char(f.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as favorite_created_at,
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
      and (f.created_at, f.card_id) < ((${cursor.createdAt}::text)::timestamptz, ${cursor.cardId}::uuid)
    order by f.created_at desc, f.card_id desc
    limit ${limit}
  ` : sql<FavoriteCardListRow[]>`
    select
      to_char(f.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as favorite_created_at,
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
    order by f.created_at desc, f.card_id desc
    limit ${limit}
  `);
  const rows = select.slice(0, page.limit);
  const tail = rows.at(-1);
  return {
    items: rows.map((row) => toCardListItem(row, env)),
    nextCursor: select.length > page.limit && tail ? encodeCursor({ createdAt: tail.favorite_created_at, cardId: tail.id }) : null,
  };
}
