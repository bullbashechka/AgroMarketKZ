import type { CardDetail, CardListItem, CardListQuery, Category, CatalogType } from "@agromarket/contracts";
import { getDb } from "../db";
import type { AppEnv } from "../env";
import { paginateRows, type PaginatedResult } from "../lib/pagination";
import { escapeLike } from "../lib/search";
import { publicImageUrl } from "../lib/storage";

// --- Строки БД ---

export interface CategoryRow {
  id: string;
  type: "product" | "service";
  name: string;
  sort_order: number;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface CardListRow {
  id: string;
  type: "product" | "service";
  category_id: string;
  title: string;
  price_type: "fixed" | "on_request";
  price_amount: number | null;
  first_image_path: string | null;
  first_spec_key: string | null;
  first_spec_value: string | null;
}

export interface CardRow {
  id: string;
  type: "product" | "service";
  category_id: string;
  title: string;
  description: string;
  price_type: "fixed" | "on_request";
  price_amount: number | null;
  sort_order: number;
  archived_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface CardImageRow {
  id: string;
  storage_path: string;
  alt_text: string | null;
  sort_order: number;
}

export interface CardSpecRow {
  id: string;
  key: string;
  value: string;
  sort_order: number;
}

// --- Мапперы (pure) ---

export function toCategory(row: CategoryRow): Category {
  return {
    id: row.id,
    type: row.type,
    name: row.name,
    sortOrder: row.sort_order,
    isActive: row.is_active,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString()
  };
}

export function toCardListItem(row: CardListRow, env: AppEnv): CardListItem {
  return {
    id: row.id,
    type: row.type,
    categoryId: row.category_id,
    title: row.title,
    priceType: row.price_type,
    priceAmount: row.price_amount,
    imageUrl: row.first_image_path ? publicImageUrl(env, row.first_image_path) : null,
    shortSpec: row.first_spec_key ? `${row.first_spec_key}: ${row.first_spec_value}` : null
  };
}

export function toCardDetail(
  row: CardRow,
  images: CardImageRow[],
  specs: CardSpecRow[],
  env: AppEnv
): CardDetail {
  return {
    id: row.id,
    type: row.type,
    categoryId: row.category_id,
    title: row.title,
    description: row.description,
    priceType: row.price_type,
    priceAmount: row.price_amount,
    sortOrder: row.sort_order,
    archivedAt: row.archived_at ? row.archived_at.toISOString() : null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    images: images.map((img) => ({
      id: img.id,
      storagePath: img.storage_path,
      url: publicImageUrl(env, img.storage_path),
      altText: img.alt_text,
      sortOrder: img.sort_order
    })),
    specs: specs.map((spec) => ({
      id: spec.id,
      key: spec.key,
      value: spec.value,
      sortOrder: spec.sort_order
    }))
  };
}

// --- Запросы к БД ---

/** Активные категории вкладки, в порядке, заданном админом. */
export async function listCategories(env: AppEnv, type: CatalogType): Promise<Category[]> {
  const sql = getDb(env);
  const rows = await sql<CategoryRow[]>`
    select id, type, name, sort_order, is_active, created_at, updated_at
    from categories
    where type = ${type} and is_active
    order by sort_order, name
  `;
  return rows.map(toCategory);
}

/**
 * Карточки вкладки с фильтрами (категория/поиск/тип цены) и постраничной выдачей.
 * Архивные карточки в список и поиск не попадают.
 */
export async function listCards(env: AppEnv, query: CardListQuery): Promise<PaginatedResult<CardListItem>> {
  const sql = getDb(env);
  const searchPattern = query.search ? `%${escapeLike(query.search)}%` : null;
  const rows = await sql<CardListRow[]>`
    select
      c.id, c.type, c.category_id, c.title, c.price_type, c.price_amount,
      img.storage_path as first_image_path,
      spec.key as first_spec_key, spec.value as first_spec_value
    from cards c
    left join lateral (
      select storage_path from card_images where card_id = c.id order by sort_order limit 1
    ) img on true
    left join lateral (
      select key, value from card_specs where card_id = c.id order by sort_order limit 1
    ) spec on true
    where c.type = ${query.type}
      and c.archived_at is null
      and (${query.categoryId ?? null}::uuid is null or c.category_id = ${query.categoryId ?? null}::uuid)
      and (${searchPattern}::text is null or c.title ilike ${searchPattern})
      and (${query.priceType ?? null}::price_type is null or c.price_type = ${query.priceType ?? null}::price_type)
    order by c.sort_order, c.title
    limit ${query.limit + 1} offset ${query.offset}
  `;
  const items = rows.map((row) => toCardListItem(row, env));
  return paginateRows(items, query.limit, query.offset);
}

/** Полная карточка по id, включая архивные (фронт показывает заглушку «снято с публикации»). */
export async function getCardById(env: AppEnv, id: string): Promise<CardDetail | undefined> {
  const sql = getDb(env);
  const [row] = await sql<CardRow[]>`
    select id, type, category_id, title, description, price_type, price_amount,
      sort_order, archived_at, created_at, updated_at
    from cards
    where id = ${id}
  `;
  if (!row) {
    return undefined;
  }
  const images = await sql<CardImageRow[]>`
    select id, storage_path, alt_text, sort_order
    from card_images where card_id = ${id} order by sort_order
  `;
  const specs = await sql<CardSpecRow[]>`
    select id, key, value, sort_order
    from card_specs where card_id = ${id} order by sort_order
  `;
  return toCardDetail(row, images, specs, env);
}
