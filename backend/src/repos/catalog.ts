import type {
  CardDetail,
  CardListItem,
  CardListQuery,
  CatalogRegionFilter,
  CatalogType,
  Category,
  CategoryListItem,
  Territory,
  VolumeTonnes,
  CommodityGroup
} from "@agromarket/contracts";
import { getDb } from "../db";
import type { AppEnv } from "../env";
import { paginateRows, type PaginatedResult } from "../lib/pagination";
import { escapeLike, normalizeCatalogText } from "../lib/search";
import { publicImageUrl } from "../lib/storage";

// --- Строки БД ---

export interface CategoryRow {
  id: string;
  type: "product" | "service";
  name: string;
  sort_order: number;
  is_active: boolean;
  is_commodity?: boolean;
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
  territory_code: string | null;
  territory_name: string | null;
  territory_kind: "region" | "republican_city" | null;
  territory_sort_order: number | null;
  ownership_form: "peasant_farm" | "llp_vat_agricultural_producer" | "llp_trader" | null;
  product_location: "elevator" | "seller_site" | null;
  service_all_kazakhstan: boolean;
  service_territories: unknown;
  first_image_path: string | null;
  first_spec_key: string | null;
  first_spec_value: string | null;
  commodity_group?: CommodityGroup | null;
  volume_tonnes?: number | string | null;
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
  territory_code: string | null;
  territory_name: string | null;
  territory_kind: "region" | "republican_city" | null;
  territory_sort_order: number | null;
  ownership_form: "peasant_farm" | "llp_vat_agricultural_producer" | "llp_trader" | null;
  product_location: "elevator" | "seller_site" | null;
  product_location_detail: string | null;
  service_all_kazakhstan: boolean;
  availability: string | null;
  sort_order: number;
  version: number;
  published_at: Date | null;
  archived_at: Date | null;
  created_at: Date;
  updated_at: Date;
  commodity_group?: CommodityGroup | null;
  volume_tonnes?: number | string | null;
}

export interface TerritoryRow {
  code: string;
  name: string;
  kind: "region" | "republican_city";
  sort_order: number;
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
    isCommodity: row.is_commodity ?? false,
    requiredSpecs: row.required_specs ?? [],
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString()
  };
}

function numericValue(value: number | string | null | undefined): VolumeTonnes | null {
  if (value == null) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function toCategoryListItem(row: CategoryListRow): CategoryListItem {
  return {
    ...toCategory(row),
    cardCount: row.card_count
  };
}

export function toTerritory(row: TerritoryRow): Territory {
  return {
    code: row.code as Territory["code"],
    name: row.name,
    kind: row.kind,
    sortOrder: row.sort_order
  };
}

function territoryFromCard(row: Pick<CardListRow, "territory_code" | "territory_name" | "territory_kind" | "territory_sort_order">): Territory | null {
  if (!row.territory_code || !row.territory_name || !row.territory_kind || row.territory_sort_order === null) return null;
  return {
    code: row.territory_code as Territory["code"],
    name: row.territory_name,
    kind: row.territory_kind,
    sortOrder: row.territory_sort_order
  };
}

function parseServiceTerritories(value: unknown): Territory[] {
  const parsed = typeof value === "string"
    ? (() => { try { return JSON.parse(value) as unknown; } catch { return []; } })()
    : value;
  if (!Array.isArray(parsed)) return [];
  return parsed.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Partial<TerritoryRow>;
    if (typeof row.code !== "string" || typeof row.name !== "string" || (row.kind !== "region" && row.kind !== "republican_city") || typeof row.sort_order !== "number") return [];
    return [toTerritory(row as TerritoryRow)];
  });
}

function isLegacyLocationSpecKey(key: string): boolean {
  const normalized = normalizeCatalogText(key).trim().toLocaleLowerCase("ru");
  return [
    "регион",
    "регион работы",
    "регион поставки",
    "география",
    "территория",
    "место нахождения",
    "местонахождение"
  ].includes(normalized);
}

export function toCardListItem(row: CardListRow, env: AppEnv): CardListItem {
  const serviceTerritories = parseServiceTerritories(row.service_territories);
  const hasStructuredLocation = row.type === "product"
    ? row.territory_code !== null
    : row.service_all_kazakhstan || serviceTerritories.length > 0;
  const legacyLocation = hasStructuredLocation ? null : row.location;
  const fallbackSpec = row.first_spec_key && (!hasStructuredLocation || !isLegacyLocationSpecKey(row.first_spec_key))
    ? `${row.first_spec_key}: ${row.first_spec_value}`
    : null;
  return {
    id: row.id,
    type: row.type,
    categoryId: row.category_id,
    title: row.title,
    priceType: row.price_type,
    priceAmount: row.price_amount,
    priceUnit: row.price_unit,
    commodityGroup: row.commodity_group ?? null,
    volumeTonnes: numericValue(row.volume_tonnes),
    imageUrl: row.first_image_path ? publicImageUrl(env, row.first_image_path) : null,
    shortSpec: row.type === "product"
      ? fallbackSpec
      : [legacyLocation, row.availability].filter(Boolean).join(" · ") || fallbackSpec,
    territory: territoryFromCard(row),
    ownershipForm: row.ownership_form,
    productLocation: row.product_location,
    serviceAllKazakhstan: row.service_all_kazakhstan,
    serviceTerritories
  };
}

export function toCardDetail(
  row: CardRow,
  images: CardImageRow[],
  specs: CardSpecRow[],
  env: AppEnv,
  serviceTerritories: Territory[] = []
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
    commodityGroup: row.commodity_group ?? null,
    volumeTonnes: numericValue(row.volume_tonnes),
    location: row.location,
    territory: territoryFromCard(row),
    ownershipForm: row.ownership_form,
    productLocation: row.product_location,
    productLocationDetail: row.product_location_detail,
    serviceAllKazakhstan: row.service_all_kazakhstan,
    serviceTerritories,
    availability: row.availability,
    sortOrder: row.sort_order,
    version: row.version,
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
 * Каталог скрывает пустые категории, а форма предложения явно запрашивает их через includeEmpty.
 */
export async function listCategories(
  env: AppEnv,
  type: CatalogType,
  includeEmpty = false
): Promise<CategoryListItem[]> {
  const sql = getDb(env);
  const rows = await sql<CategoryListRow[]>`
    select
      cat.id, cat.type, cat.name, cat.sort_order, cat.is_active, cat.is_commodity, cat.required_specs,
      cat.created_at, cat.updated_at,
      count(c.id)::int as card_count
    from categories cat
    left join cards c on c.category_id = cat.id
      and c.published_at is not null and c.archived_at is null
    where cat.type = ${type} and cat.is_active
    group by cat.id
    having ${includeEmpty} or count(c.id) > 0
    order by cat.sort_order, cat.name
  `;
  return rows.map(toCategoryListItem);
}

/** Справочник точных территорий для фильтра и административных форм. */
export async function listTerritories(env: AppEnv): Promise<Territory[]> {
  const sql = getDb(env);
  const rows = await sql<TerritoryRow[]>`
    select code, name, kind, sort_order from territories order by sort_order
  `;
  return rows.map(toTerritory);
}

const republicanCityCodes = ["almaty_city", "astana_city", "shymkent_city"];

function territoryCodesForFilter(region: CatalogRegionFilter): string[] | null {
  if (region === "all_regions") return null;
  if (region === "republican_cities") return republicanCityCodes;
  return [region];
}

/**
 * Карточки вкладки с фильтрами (категория/поиск/тип цены) и постраничной выдачей.
 * Архивные карточки в список и поиск не попадают.
 */
export async function listCards(env: AppEnv, query: CardListQuery): Promise<PaginatedResult<CardListItem>> {
  const sql = getDb(env);
  const searchPattern = query.search ? `%${escapeLike(normalizeCatalogText(query.search))}%` : null;
  const regionCodes = territoryCodesForFilter(query.region);
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
    from cards c
    join categories cat on cat.id = c.category_id
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
    where c.type = ${query.type}
      and c.archived_at is null
      and c.published_at is not null
      and (${query.categoryId ?? null}::uuid is null or c.category_id = ${query.categoryId ?? null}::uuid)
      and (${searchPattern}::text is null or c.title ilike ${searchPattern} or cat.name ilike ${searchPattern})
      and (
        ${query.price ?? null}::text is null
        or (${query.price ?? null}::text = 'with_price' and c.price_type in ('fixed', 'from'))
        or (${query.price ?? null}::text = 'on_request' and c.price_type = 'on_request')
      )
      and (
        ${regionCodes}::text[] is null
        or (c.type = 'product' and c.territory_code = any(${regionCodes}::text[]))
        or (
          c.type = 'service' and (
            c.service_all_kazakhstan
            or exists (
              select 1 from card_service_territories cst
              where cst.card_id = c.id and cst.territory_code = any(${regionCodes}::text[])
            )
          )
        )
      )
      and (
        ${query.type !== "product" || !query.commodityGroups?.length ? null : query.commodityGroups}::text[] is null
        or c.commodity_group = any(${query.commodityGroups?.length ? query.commodityGroups : null}::text[])
      )
      and (
        ${query.type !== "product" || !query.ownershipForms?.length ? null : query.ownershipForms}::text[] is null
        or c.ownership_form = any(${query.ownershipForms?.length ? query.ownershipForms : null}::text[])
      )
      and (
        ${query.type !== "product" || query.productLocation === "all" ? null : query.productLocation}::text is null
        or c.product_location = ${query.productLocation === "all" ? null : query.productLocation}::text
      )
    order by
      case when ${query.sort} = 'price_asc' and c.type = 'product' then c.price_amount end asc nulls last,
      case when ${query.sort} = 'volume_asc' and c.type = 'product' then c.volume_tonnes end asc nulls last,
      c.sort_order, c.title, c.id
    limit ${query.limit + 1} offset ${query.offset}
  `;
  const items = rows.map((row) => toCardListItem(row, env));
  return paginateRows(items, query.limit, query.offset);
}

async function getCard(env: AppEnv, id: string, includeDraft: boolean): Promise<CardDetail | undefined> {
  const sql = getDb(env);
  const [row] = await sql<CardRow[]>`
    select id, type, category_id, title, description, price_type, price_amount,
      price_unit, price_reason, location, availability, commodity_group, volume_tonnes,
      c.territory_code, territory.name as territory_name, territory.kind as territory_kind,
      territory.sort_order as territory_sort_order,
      c.ownership_form, c.product_location, c.product_location_detail, c.service_all_kazakhstan,
      c.sort_order, c.version,
      published_at, archived_at, created_at, updated_at
    from cards c
    left join territories territory on territory.code = c.territory_code
    where c.id = ${id}
      and (${includeDraft} or (c.published_at is not null and c.archived_at is null))
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
  const serviceTerritories = await sql<TerritoryRow[]>`
    select t.code, t.name, t.kind, t.sort_order
    from card_service_territories cst
    join territories t on t.code = cst.territory_code
    where cst.card_id = ${id}
    order by cst.sort_order
  `;
  return toCardDetail(row, images, specs, env, serviceTerritories.map(toTerritory));
}

/** Публичная деталка: черновики не существуют для пользователя, скрытые дают заглушку. */
export async function getCardById(env: AppEnv, id: string): Promise<CardDetail | undefined> {
  return getCard(env, id, false);
}

/** Админская деталка: включает серверные черновики. */
export async function getCardByIdAdmin(env: AppEnv, id: string): Promise<CardDetail | undefined> {
  return getCard(env, id, true);
}
