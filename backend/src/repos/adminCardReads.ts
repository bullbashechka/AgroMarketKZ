import type {
  AdminCardDetail,
  AdminCardListItem,
  AdminCardListQuery,
  CardDetail,
} from "@agromarket/contracts";
import { getPublicationStatus } from "@agromarket/contracts";
import type { TransactionSql } from "postgres";
import type { Database } from "../db";
import type { AppEnv } from "../env";
import { HttpError } from "../lib/errors";
import { paginateRows, type PaginatedResult } from "../lib/pagination";
import { escapeLike, normalizeCatalogText } from "../lib/search";
import {
  getPublicationIssueMessages,
  toPublicationCandidateFromAdminList,
  toPublicationCandidateFromDetail,
} from "./adminCardPolicy";
import {
  type CardImageRow,
  type CardListRow,
  type CardRow,
  type CardSpecRow,
  type TerritoryRow,
  getCardByIdAdmin,
  toCardDetail,
  toCardListItem,
  toTerritory,
} from "./catalog";

interface AdminCardListRow extends CardListRow {
  description: string;
  price_reason: string | null;
  sort_order: number;
  published_at: Date | null;
  archived_at: Date | null;
  image_count: number;
  spec_keys: string[];
  required_specs: string[];
  updated_at: Date;
  service_territory_count: number;
  is_commodity: boolean;
}

function toAdminCardListItem(row: AdminCardListRow, env: AppEnv): AdminCardListItem {
  const reviewIssues = getPublicationIssueMessages(toPublicationCandidateFromAdminList(row));
  return {
    ...toCardListItem(row, env),
    sortOrder: row.sort_order,
    publishedAt: row.published_at?.toISOString() ?? null,
    archivedAt: row.archived_at?.toISOString() ?? null,
    publicationStatus: getPublicationStatus(row.published_at, row.archived_at),
    needsReview: reviewIssues.length > 0,
    reviewIssues,
    updatedAt: row.updated_at.toISOString(),
  };
}

/** Список карточек для админки без публичного фильтра видимости. */
export async function adminListCards(
  env: AppEnv,
  query: AdminCardListQuery,
  db: Database,
): Promise<PaginatedResult<AdminCardListItem>> {
  const sql = db.sql;
  const searchPattern = query.search ? `%${escapeLike(normalizeCatalogText(query.search))}%` : null;
  const archivedFilter = query.archived === "active" ? false : query.archived === "archived" ? true : null;
  const rows = await sql<AdminCardListRow[]>`
    select
      c.id, c.type, c.category_id, c.title, c.description, c.price_type, c.price_amount,
      c.price_unit, c.price_reason, c.location, c.availability, c.commodity_group, c.volume_tonnes,
      c.territory_code, territory.name as territory_name, territory.kind as territory_kind,
      territory.sort_order as territory_sort_order,
      c.ownership_form, c.product_location, c.service_all_kazakhstan,
      c.sort_order, c.published_at, c.archived_at, c.updated_at,
      cat.required_specs, cat.is_commodity,
      img.first_image_path, img.image_count,
      service.service_territories, service.service_territory_count,
      spec.first_spec_key, spec.first_spec_value, spec.spec_keys
    from cards c
    join categories cat on cat.id = c.category_id
    left join territories territory on territory.code = c.territory_code
    left join lateral (
      select
        (array_agg(storage_path order by sort_order))[1] as first_image_path,
        count(*)::int as image_count
      from card_images where card_id = c.id
    ) img on true
    left join lateral (
      select
        coalesce(json_agg(json_build_object(
          'code', t.code, 'name', t.name, 'kind', t.kind, 'sort_order', t.sort_order
        ) order by cst.sort_order), '[]'::json) as service_territories,
        count(*)::int as service_territory_count
      from card_service_territories cst
      join territories t on t.code = cst.territory_code
      where cst.card_id = c.id
    ) service on true
    left join lateral (
      select
        (array_agg(key order by sort_order))[1] as first_spec_key,
        (array_agg(value order by sort_order))[1] as first_spec_value,
        coalesce(array_agg(key order by sort_order), '{}') as spec_keys
      from card_specs where card_id = c.id
    ) spec on true
    where (${query.type ?? null}::catalog_type is null or c.type = ${query.type ?? null}::catalog_type)
      and (${query.categoryId ?? null}::uuid is null or c.category_id = ${query.categoryId ?? null}::uuid)
      and (${searchPattern}::text is null or c.title ilike ${searchPattern})
      and (${archivedFilter}::boolean is null or (c.archived_at is not null) = ${archivedFilter}::boolean)
    order by c.sort_order, c.title, c.id
    limit ${query.limit + 1} offset ${query.offset}
  `;
  return paginateRows(
    rows.map((row) => toAdminCardListItem(row, env)),
    query.limit,
    query.offset,
  );
}

export function toAdminCardDetailWithRequiredSpecs(
  detail: CardDetail,
  requiredSpecs: string[],
  categoryIsCommodity: boolean,
): AdminCardDetail {
  const reviewIssues = getPublicationIssueMessages(toPublicationCandidateFromDetail(detail, {
    categoryIsCommodity,
    requiredSpecs,
  }));
  return {
    ...detail,
    publicationStatus: getPublicationStatus(
      detail.publishedAt ? new Date(detail.publishedAt) : null,
      detail.archivedAt ? new Date(detail.archivedAt) : null,
    ),
    needsReview: reviewIssues.length > 0,
    reviewIssues,
  };
}

async function toAdminCardDetail(env: AppEnv, detail: CardDetail, db: Database): Promise<AdminCardDetail> {
  const [category] = await db.sql<{ required_specs: string[]; is_commodity: boolean }[]>`
    select required_specs, is_commodity from categories where id = ${detail.categoryId}
  `;
  return toAdminCardDetailWithRequiredSpecs(detail, category?.required_specs ?? [], category?.is_commodity ?? false);
}

export async function getAdminCardDetailInTransaction(
  env: AppEnv,
  tx: TransactionSql,
  id: string,
): Promise<AdminCardDetail | undefined> {
  const [row] = await tx<CardRow[]>`
    select
      c.id, c.type, c.category_id, c.title, c.description, c.price_type, c.price_amount,
      c.price_unit, c.price_reason, c.location, c.availability, c.commodity_group, c.volume_tonnes,
      c.territory_code, territory.name as territory_name, territory.kind as territory_kind,
      territory.sort_order as territory_sort_order,
      c.ownership_form, c.product_location, c.product_location_detail, c.service_all_kazakhstan,
      c.sort_order, c.version, c.published_at, c.archived_at, c.created_at, c.updated_at
    from cards c
    left join territories territory on territory.code = c.territory_code
    where c.id = ${id}
    for share of c
  `;
  if (!row) return undefined;
  const images = await tx<CardImageRow[]>`
    select id, storage_path, alt_text, sort_order
    from card_images where card_id = ${id} order by sort_order
  `;
  const specs = await tx<CardSpecRow[]>`
    select id, key, value, sort_order
    from card_specs where card_id = ${id} order by sort_order
  `;
  const serviceTerritories = await tx<TerritoryRow[]>`
    select t.code, t.name, t.kind, t.sort_order
    from card_service_territories cst
    join territories t on t.code = cst.territory_code
    where cst.card_id = ${id}
    order by cst.sort_order
  `;
  const [category] = await tx<{ required_specs: string[]; is_commodity: boolean }[]>`
    select required_specs, is_commodity from categories where id = ${row.category_id}
    for share
  `;
  if (!category) return undefined;
  return toAdminCardDetailWithRequiredSpecs(
    toCardDetail(row, images, specs, env, serviceTerritories.map(toTerritory)),
    category.required_specs,
    category.is_commodity,
  );
}

export async function getAdminCardDetail(env: AppEnv, id: string, db: Database): Promise<AdminCardDetail | undefined> {
  const detail = await getCardByIdAdmin(env, id, db);
  return detail ? toAdminCardDetail(env, detail, db) : undefined;
}

/** Возвращает detail только для точно закоммиченной mutation receipt. */
export async function getAdminCardDetailForMutation(
  env: AppEnv,
  id: string,
  mutationId: string,
  db: Database,
): Promise<AdminCardDetail | undefined> {
  return db.sql.begin(async (tx) => {
    const [receipt] = await tx<{ card_id: string; result_version: number }[]>`
      select card_id, result_version
      from card_update_mutations
      where mutation_id = ${mutationId} and card_id = ${id}
    `;
    if (!receipt) return undefined;
    const detail = await getAdminCardDetailInTransaction(env, tx, id);
    const [finalCard] = await tx<{ version: number }[]>`select version from cards where id = ${id}`;
    if (
      !detail
      || detail.version !== receipt.result_version
      || finalCard?.version !== receipt.result_version
    ) {
      throw new HttpError(409, "Карточка уже изменена после этого сохранения. Обновите данные перед публикацией", {
        code: "CARD_CHANGED_AFTER_REPLAY",
      });
    }
    return detail;
  });
}
