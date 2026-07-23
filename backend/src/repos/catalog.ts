import type {
  CardDetail,
  CardListItem,
  CardListQuery,
  CatalogType,
  Category,
  CategoryListItem
} from "@agromarket/contracts";
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
  required_specs: string[];
  created_at: Date;
  updated_at: Date;
}

export interface CategoryListRow extends CategoryRow {
  card_count: number;
}

export interface CardListRow {
  id: string;
  type: "product" | "service";
  category_id: string;
  title: string;
  price_type: "fixed" | "from" | "on_request";
  price_amount: number | null;
  price_unit: string | null;
  location: string | null;
  availability: string | null;
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
  price_type: "fixed" | "from" | "on_request";
  price_amount: number | null;
  price_unit: string | null;
  price_reason: string | null;
  location: string | null;
  availability: string | null;
  sort_order: number;
  published_at: Date | null;
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
    requiredSpecs: row.required_specs,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString()
  };
}

export function toCategoryListItem(row: CategoryListRow): CategoryListItem {
  return {
    ...toCategory(row),
    cardCount: row.card_count
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
    priceUnit: row.price_unit,
    imageUrl: row.first_image_path ? publicImageUrl(env, row.first_image_path) : null,
    shortSpec:
      row.location && row.availability
        ? `${row.location} · ${row.availability}`
        : row.first_spec_key
          ? `${row.first_spec_key}: ${row.first_spec_value}`
          : null
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
    priceUnit: row.price_unit,
    priceReason: row.price_reason,
    location: row.location,
    availability: row.availability,
    sortOrder: row.sort_order,
    publishedAt: row.published_at ? row.published_at.toISOString() : null,
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

/**
 * Активные категории вкладки с числом опубликованных карточек, в порядке, заданном админом.
 * Категории без карточек скрываются от пользователей (их видит только админ-раздел).
 */
export async function listCategories(env: AppEnv, type: CatalogType): Promise<CategoryListItem[]> {
  const sql = getDb(env);
  const rows = await sql<CategoryListRow[]>`
    select
      cat.id, cat.type, cat.name, cat.sort_order, cat.is_active, cat.required_specs,
      cat.created_at, cat.updated_at,
      count(c.id)::int as card_count
    from categories cat
    join cards c on c.category_id = cat.id
      and c.published_at is not null and c.archived_at is null
    where cat.type = ${type} and cat.is_active
    group by cat.id
    order by cat.sort_order, cat.name
  `;
  return rows.map(toCategoryListItem);
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
      c.price_unit, c.location, c.availability,
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
      and c.published_at is not null
      and (${query.categoryId ?? null}::uuid is null or c.category_id = ${query.categoryId ?? null}::uuid)
      and (${searchPattern}::text is null or c.title ilike ${searchPattern})
      and (
        ${query.price ?? null}::text is null
        or (${query.price ?? null}::text = 'with_price' and c.price_type in ('fixed', 'from'))
        or (${query.price ?? null}::text = 'on_request' and c.price_type = 'on_request')
      )
    order by c.sort_order, c.title, c.id
    limit ${query.limit + 1} offset ${query.offset}
  `;
  const items = rows.map((row) => toCardListItem(row, env));
  return paginateRows(items, query.limit, query.offset);
}

async function getCard(env: AppEnv, id: string, includeDraft: boolean): Promise<CardDetail | undefined> {
  const sql = getDb(env);
  const [row] = await sql<CardRow[]>`
    select id, type, category_id, title, description, price_type, price_amount,
      price_unit, price_reason, location, availability, sort_order,
      published_at, archived_at, created_at, updated_at
    from cards
    where id = ${id} and (${includeDraft} or published_at is not null)
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

/** Публичная деталка: черновики не существуют для пользователя, скрытые дают заглушку. */
export async function getCardById(env: AppEnv, id: string): Promise<CardDetail | undefined> {
  return getCard(env, id, false);
}

/** Админская деталка: включает серверные черновики. */
export async function getCardByIdAdmin(env: AppEnv, id: string): Promise<CardDetail | undefined> {
  return getCard(env, id, true);
}
