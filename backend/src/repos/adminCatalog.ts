import type {
  AdminCardListItem,
  AdminCardDetail,
  AdminCardListQuery,
  AdminCategory,
  CardDetail,
  Category,
  CatalogType,
  CreateCardInput,
  CreateCategoryInput,
  UpdateCardInput,
  UpdateCategoryInput
} from "@agromarket/contracts";
import { getDb } from "../db";
import type { AppEnv } from "../env";
import { HttpError } from "../lib/errors";
import { paginateRows, type PaginatedResult } from "../lib/pagination";
import { getPublicationIssues, getPublicationStatus } from "../lib/publication";
import { escapeLike, normalizeCatalogText } from "../lib/search";
import {
  type CardListRow,
  type CardRow,
  type CardImageRow,
  type CardSpecRow,
  type CategoryRow,
  type TerritoryRow,
  toCardDetail,
  toCardListItem,
  toCategory,
  toTerritory,
  getCardByIdAdmin,
} from "./catalog";

function isPgError(err: unknown, code: string): boolean {
  return typeof err === "object" && err !== null && String((err as { code?: unknown }).code) === code;
}

function pgConstraint(err: unknown): string | undefined {
  if (typeof err !== "object" || err === null) return undefined;
  const source = err as { constraint?: unknown; constraint_name?: unknown };
  const constraint = source.constraint ?? source.constraint_name;
  return typeof constraint === "string" ? constraint : undefined;
}

const CARD_CHECK_CONSTRAINTS = new Set([
  "cards_archived_requires_publication",
  "cards_availability_not_blank",
  "cards_location_not_blank",
  "cards_ownership_form_valid",
  "cards_price_reason_not_blank",
  "cards_price_unit_not_blank",
  "cards_product_location_detail_not_blank",
  "cards_product_location_valid",
  "cards_published_price_complete",
  "cards_published_product_fields_complete",
  "cards_commodity_group_valid",
  "cards_volume_tonnes_valid",
  "cards_commodity_fields_shape",
  "cards_product_territory_region",
  "cards_title_not_blank",
  "cards_type_specific_fields",
  "cards_valid_price",
  "cards_version_positive",
  "card_images_alt_text_not_blank",
  "card_images_storage_path_not_blank",
  "card_specs_key_not_blank",
  "card_specs_value_not_blank",
  "card_service_territories_sort_order_nonnegative",
]);

/** Преобразует ожидаемые ошибки целостности формы в понятный 4xx, не скрывая неизвестные сбои. */
export function cardConstraintError(err: unknown): HttpError | undefined {
  const constraint = pgConstraint(err);
  if (isPgError(err, "23503")) {
    if (constraint === "cards_category_type_fkey") {
      return new HttpError(400, "Категория не подходит по типу карточки", { code: "CATEGORY_TYPE_MISMATCH" });
    }
    if (constraint === "cards_territory_code_fkey" || constraint === "card_service_territories_territory_code_fkey") {
      return new HttpError(400, "Выбранный регион больше недоступен", { code: "TERRITORY_NOT_FOUND" });
    }
  }
  if (isPgError(err, "23505")) {
    if (constraint === "card_images_card_path_unique") {
      return new HttpError(400, "Одно и то же фото добавлено повторно", { code: "DUPLICATE_IMAGE" });
    }
    if (constraint === "card_specs_card_key_uidx") {
      return new HttpError(400, "Характеристики не должны повторяться по названию", { code: "DUPLICATE_SPEC" });
    }
    if (constraint === "card_update_mutations_pkey") {
      return new HttpError(409, "Эта попытка изменения уже использована", {
        code: "CARD_UPDATE_REQUEST_REUSED",
      });
    }
  }
  if (isPgError(err, "23514") && constraint && CARD_CHECK_CONSTRAINTS.has(constraint)) {
    return new HttpError(400, "Карточка не соответствует требованиям публикации", {
      code: "CARD_CONSTRAINT_VIOLATION",
    });
  }
  return undefined;
}

function normalizeCardInput(input: CreateCardInput): CreateCardInput {
  return {
    ...input,
    title: normalizeCatalogText(input.title),
    description: normalizeCatalogText(input.description),
    location: input.location ? normalizeCatalogText(input.location) : input.location,
    availability: input.type === "service" && input.availability
      ? normalizeCatalogText(input.availability)
      : input.type === "service" ? input.availability : undefined,
    productLocationDetail: input.productLocationDetail
      ? normalizeCatalogText(input.productLocationDetail)
      : input.productLocationDetail,
    specs: input.specs.map((spec) => ({
      ...spec,
      key: normalizeCatalogText(spec.key),
      value: normalizeCatalogText(spec.value)
    }))
  };
}

function validateCategoryFields(input: CreateCardInput, isCommodity: boolean): void {
  if (input.type !== "product") return;
  const hasCommodityFields = input.commodityGroup != null || input.volumeTonnes != null;
  if (!isCommodity && hasCommodityFields) {
    throw new HttpError(400, "Выбранная категория не использует группу и объём товара");
  }
}

/**
 * Стабильное представление PUT для server-side receipt. Не включает mutationId:
 * идентификатор сам является ключом receipt, а payload нужен для защиты replay
 * другим набором данных.
 */
function cardUpdatePayload(input: CreateCardInput, expectedVersion: number): string {
  return JSON.stringify({
    expectedVersion,
    type: input.type,
    categoryId: input.categoryId,
    title: input.title,
    description: input.description,
    priceType: input.priceType,
    priceAmount: input.priceType === "on_request" ? null : input.priceAmount ?? null,
    priceUnit: input.priceUnit ?? null,
    priceReason: input.priceType === "fixed" ? null : input.priceReason ?? null,
    location: input.location ?? null,
    territoryCode: input.type === "product" ? input.territoryCode ?? null : null,
    ownershipForm: input.type === "product" ? input.ownershipForm ?? null : null,
    productLocation: input.type === "product" ? input.productLocation ?? null : null,
    productLocationDetail: input.type === "product" ? input.productLocationDetail ?? null : null,
    commodityGroup: input.type === "product" ? input.commodityGroup ?? null : null,
    volumeTonnes: input.type === "product" ? input.volumeTonnes ?? null : null,
    serviceAllKazakhstan: input.type === "service" && input.serviceAllKazakhstan,
    serviceTerritoryCodes: input.type === "service" && !input.serviceAllKazakhstan
      ? input.serviceTerritoryCodes
      : [],
    availability: input.type === "service" ? input.availability ?? null : null,
    sortOrder: input.sortOrder,
    images: input.images.map((image) => ({
      storagePath: image.storagePath,
      altText: image.altText ?? null,
      sortOrder: image.sortOrder,
    })),
    specs: input.specs.map((spec) => ({
      key: spec.key,
      value: spec.value,
      sortOrder: spec.sortOrder,
    })),
  });
}

function sameCardImageInputs(
  detail: AdminCardDetail,
  input: CreateCardInput,
): boolean {
  return detail.images.length === input.images.length
    && detail.images.every((image, index) => {
      const expected = input.images[index];
      return expected !== undefined
        && image.storagePath === expected.storagePath
        && image.altText === (expected.altText ?? null)
        && image.sortOrder === expected.sortOrder;
    });
}

function sameCardSpecInputs(
  detail: AdminCardDetail,
  input: CreateCardInput,
): boolean {
  return detail.specs.length === input.specs.length
    && detail.specs.every((spec, index) => {
      const expected = input.specs[index];
      return expected !== undefined
        && spec.key === expected.key
        && spec.value === expected.value
        && spec.sortOrder === expected.sortOrder;
    });
}

/** Проверяет replay create-запроса перед возвратом уже сохранённой карточки. */
export function cardMatchesCreateInput(
  detail: AdminCardDetail,
  input: CreateCardInput,
  expectedLocation?: string | null,
): boolean {
  const expectedPriceAmount = input.priceType === "on_request" ? null : input.priceAmount ?? null;
  const expectedPriceReason = input.priceType === "fixed" ? null : input.priceReason ?? null;
  const expectedServiceTerritories = input.type === "service" && !input.serviceAllKazakhstan
    ? input.serviceTerritoryCodes
    : [];

  return detail.type === input.type
    && detail.categoryId === input.categoryId
    && detail.title === input.title
    && detail.description === input.description
    && detail.priceType === input.priceType
    && detail.priceAmount === expectedPriceAmount
    && detail.priceUnit === (input.priceUnit ?? null)
    && detail.priceReason === expectedPriceReason
    && detail.availability === (input.type === "service" || detail.availability !== null ? input.availability ?? null : null)
    && (expectedLocation === undefined || detail.location === expectedLocation)
    && detail.sortOrder === input.sortOrder
    && (detail.territory?.code ?? null) === (input.type === "product" ? input.territoryCode ?? null : null)
    && detail.ownershipForm === (input.type === "product" ? input.ownershipForm ?? null : null)
    && detail.productLocation === (input.type === "product" ? input.productLocation ?? null : null)
    && detail.productLocationDetail === (input.type === "product" ? input.productLocationDetail ?? null : null)
    && (detail.commodityGroup ?? null) === (input.type === "product" ? input.commodityGroup ?? null : null)
    && (detail.volumeTonnes ?? null) === (input.type === "product" ? input.volumeTonnes ?? null : null)
    && detail.serviceAllKazakhstan === (input.type === "service" && input.serviceAllKazakhstan)
    && detail.serviceTerritories.length === expectedServiceTerritories.length
    && detail.serviceTerritories.every((territory, index) => territory.code === expectedServiceTerritories[index])
    && sameCardImageInputs(detail, input)
    && sameCardSpecInputs(detail, input);
}

async function legacyLocationForInput(env: AppEnv, input: CreateCardInput): Promise<string | null> {
  if (input.type === "product") {
    if (!input.territoryCode) return input.location ?? null;
    const sql = getDb(env);
    const [territory] = await sql<{ name: string }[]>`
      select name from territories where code = ${input.territoryCode}
    `;
    return territory?.name ?? input.location ?? null;
  }

  if (input.serviceAllKazakhstan) return "Весь Казахстан";
  if (input.serviceTerritoryCodes.length === 0) return input.location ?? null;
  const sql = getDb(env);
  const rows = await sql<{ code: string; name: string }[]>`
    select code, name from territories where code = any(${input.serviceTerritoryCodes}::text[])
  `;
  const namesByCode = new Map(rows.map((row) => [row.code, row.name]));
  const names = input.serviceTerritoryCodes.flatMap((code) => {
    const name = namesByCode.get(code);
    return name ? [name] : [];
  });
  if (names.length <= 3) return names.join(", ");
  return `Регион работы: ${names.length} регионов`;
}

interface AdminCategoryRow extends CategoryRow {
  card_count: number;
  active_card_count: number;
}

function toAdminCategory(row: AdminCategoryRow): AdminCategory {
  return {
    ...toCategory(row),
    cardCount: row.card_count,
    activeCardCount: row.active_card_count
  };
}

/** Все категории вкладки (включая неактивные) — со счётчиками карточек для админ-списка. */
export async function listCategoriesAdmin(env: AppEnv, type: CatalogType): Promise<AdminCategory[]> {
  const sql = getDb(env);
  const rows = await sql<AdminCategoryRow[]>`
    select
      cat.id, cat.type, cat.name, cat.sort_order, cat.is_active, cat.is_commodity, cat.created_at, cat.updated_at,
      cat.required_specs,
      count(c.id)::int as card_count,
      count(c.id) filter (
        where c.published_at is not null and c.archived_at is null
      )::int as active_card_count
    from categories cat
    left join cards c on c.category_id = cat.id
    where cat.type = ${type}
    group by cat.id
    order by cat.sort_order, cat.name
  `;
  return rows.map(toAdminCategory);
}

/** Создание категории. 409, если активная категория с таким названием уже есть. */
export async function createCategory(env: AppEnv, input: CreateCategoryInput): Promise<Category> {
  const sql = getDb(env);
  const name = normalizeCatalogText(input.name);
  try {
    const [row] = await sql<CategoryRow[]>`
      insert into categories (type, name, sort_order, is_commodity, required_specs)
      values (${input.type}, ${name}, ${input.sortOrder}, ${input.type === "product" && input.isCommodity}, ${input.requiredSpecs.map(normalizeCatalogText)})
      returning id, type, name, sort_order, is_active, is_commodity, required_specs, created_at, updated_at
    `;
    return toCategory(row!);
  } catch (err) {
    if (isPgError(err, "23505")) {
      throw new HttpError(409, "Категория с таким названием уже есть");
    }
    throw err;
  }
}

/** Переименование/перемещение категории. Тип не меняется. */
export async function updateCategory(
  env: AppEnv,
  id: string,
  input: UpdateCategoryInput
): Promise<Category> {
  const sql = getDb(env);
  if (input.isCommodity !== undefined) {
    const [current] = await sql<{ type: CatalogType; is_commodity: boolean }[]>`
      select type, is_commodity from categories where id = ${id}
    `;
    if (!current) throw new HttpError(404, "Категория не найдена");
    if (current.type === "service" && input.isCommodity) {
      throw new HttpError(400, "Группа продукции доступна только для товарной категории");
    }
    if (current.is_commodity !== input.isCommodity) {
      const [active] = await sql<{ count: string }[]>`
        select count(*) from cards
        where category_id = ${id} and published_at is not null and archived_at is null
      `;
      if (Number(active?.count ?? 0) > 0) {
        throw new HttpError(409, "Сначала скройте опубликованные карточки в категории, затем измените признак товарной категории");
      }
    }
  }
  const columns: Record<string, string | number | boolean | string[]> = {};
  if (input.name !== undefined) columns.name = normalizeCatalogText(input.name);
  if (input.sortOrder !== undefined) columns.sort_order = input.sortOrder;
  if (input.requiredSpecs !== undefined) columns.required_specs = input.requiredSpecs.map(normalizeCatalogText);
  if (input.isCommodity !== undefined) columns.is_commodity = input.isCommodity;

  const keys = Object.keys(columns);
  if (keys.length === 0) {
    const [row] = await sql<CategoryRow[]>`
      select id, type, name, sort_order, is_active, is_commodity, required_specs, created_at, updated_at
      from categories where id = ${id}
    `;
    if (!row) throw new HttpError(404, "Категория не найдена");
    return toCategory(row);
  }

  try {
    const [row] = await sql<CategoryRow[]>`
      update categories set ${sql(columns, ...keys)}
      where id = ${id}
      returning id, type, name, sort_order, is_active, is_commodity, required_specs, created_at, updated_at
    `;
    if (!row) throw new HttpError(404, "Категория не найдена");
    return toCategory(row);
  } catch (err) {
    if (isPgError(err, "23505")) {
      throw new HttpError(409, "Категория с таким названием уже есть");
    }
    throw err;
  }
}

/** Удаление категории. Запрещено, пока в ней есть карточки. */
export async function deleteCategory(env: AppEnv, id: string): Promise<void> {
  const sql = getDb(env);
  const [row] = await sql<{ count: string }[]>`
    select count(*) from cards where category_id = ${id}
  `;
  if (Number(row?.count ?? 0) > 0) {
    throw new HttpError(409, "Нельзя удалить категорию, пока в ней есть карточки");
  }
  try {
    const [row] = await sql<{ id: string }[]>`delete from categories where id = ${id} returning id`;
    if (!row) {
      throw new HttpError(404, "Категория не найдена");
    }
  } catch (err) {
    if (err instanceof HttpError) throw err;
    if (isPgError(err, "23503")) {
      throw new HttpError(409, "Нельзя удалить категорию, пока в ней есть карточки");
    }
    throw err;
  }
}

// --- Карточки ---

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
  const reviewIssues = getPublicationIssues({
    type: row.type,
    description: row.description,
    priceType: row.price_type,
    priceAmount: row.price_amount,
    priceUnit: row.price_unit,
    priceReason: row.price_reason,
    territoryCode: row.territory_code,
    ownershipForm: row.ownership_form,
    productLocation: row.product_location,
    categoryIsCommodity: row.is_commodity,
    commodityGroup: row.commodity_group,
    volumeTonnes: row.volume_tonnes === null ? null : Number(row.volume_tonnes),
    serviceAllKazakhstan: row.service_all_kazakhstan,
    serviceTerritoryCount: row.service_territory_count,
    availability: row.availability,
    imageCount: row.image_count,
    specs: row.spec_keys.map((key) => ({ key, value: "filled" })),
    requiredSpecs: row.required_specs,
  });
  return {
    ...toCardListItem(row, env),
    sortOrder: row.sort_order,
    publishedAt: row.published_at ? row.published_at.toISOString() : null,
    archivedAt: row.archived_at ? row.archived_at.toISOString() : null,
    publicationStatus: getPublicationStatus(row.published_at, row.archived_at),
    needsReview: reviewIssues.length > 0,
    reviewIssues,
    updatedAt: row.updated_at.toISOString()
  };
}

/** Список карточек (админ) — как публичный каталог, но без фильтра по видимости. */
export async function adminListCards(
  env: AppEnv,
  query: AdminCardListQuery
): Promise<PaginatedResult<AdminCardListItem>> {
  const sql = getDb(env);
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
  const items = rows.map((row) => toAdminCardListItem(row, env));
  return paginateRows(items, query.limit, query.offset);
}

function toAdminCardDetailWithRequiredSpecs(
  detail: CardDetail,
  requiredSpecs: string[],
  categoryIsCommodity: boolean,
): AdminCardDetail {
  const reviewIssues = getPublicationIssues({
    type: detail.type,
    description: detail.description,
    priceType: detail.priceType,
    priceAmount: detail.priceAmount,
    priceUnit: detail.priceUnit,
    priceReason: detail.priceReason,
    territoryCode: detail.territory?.code ?? null,
    ownershipForm: detail.ownershipForm,
    productLocation: detail.productLocation,
    categoryIsCommodity,
    commodityGroup: detail.commodityGroup,
    volumeTonnes: detail.volumeTonnes,
    serviceAllKazakhstan: detail.serviceAllKazakhstan,
    serviceTerritoryCount: detail.serviceTerritories.length,
    availability: detail.availability,
    imageCount: detail.images.length,
    specs: detail.specs,
    requiredSpecs,
  });
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

async function toAdminCardDetail(env: AppEnv, detail: CardDetail): Promise<AdminCardDetail> {
  const sql = getDb(env);
  const [category] = await sql<{ required_specs: string[]; is_commodity: boolean }[]>`
    select required_specs, is_commodity from categories where id = ${detail.categoryId}
  `;
  return toAdminCardDetailWithRequiredSpecs(detail, category?.required_specs ?? [], category?.is_commodity ?? false);
}

export async function getAdminCardDetail(env: AppEnv, id: string): Promise<AdminCardDetail | undefined> {
  const detail = await getCardByIdAdmin(env, id);
  return detail ? toAdminCardDetail(env, detail) : undefined;
}

/**
 * Reads a card only when the exact update mutation was committed. A normal GET
 * must not be used for ambiguous PUT recovery: another editor may have written
 * the same values with a different mutation id.
 */
export async function getAdminCardDetailForMutation(
  env: AppEnv,
  id: string,
  mutationId: string,
): Promise<AdminCardDetail | undefined> {
  const sql = getDb(env);
  const [receipt] = await sql<{ card_id: string; result_version: number }[]>`
    select card_id, result_version
    from card_update_mutations
    where mutation_id = ${mutationId} and card_id = ${id}
  `;
  if (!receipt) return undefined;
  const detail = await getAdminCardDetail(env, id);
  return detail?.version === receipt.result_version ? detail : undefined;
}

/** Создаёт серверный черновик вместе с уже успешно загруженными фото и характеристиками. */
export async function createCard(env: AppEnv, input: CreateCardInput): Promise<AdminCardDetail> {
  const sql = getDb(env);
  const normalizedInput = normalizeCardInput(input);
  const legacyLocation = await legacyLocationForInput(env, normalizedInput);
  const cardId = normalizedInput.clientRequestId ?? crypto.randomUUID();
  let replayedCardId: string | undefined;
  try {
    const detail = await sql.begin(async (tx) => {
      const [cardCategory] = await tx<{ is_commodity: boolean }[]>`
        select is_commodity from categories
        where id = ${normalizedInput.categoryId} and type = ${normalizedInput.type}
      `;
      if (!cardCategory) throw new HttpError(400, "Категория не подходит по типу карточки");
      validateCategoryFields(normalizedInput, cardCategory.is_commodity);
      const [card] = await tx<{ id: string }[]>`
        insert into cards (
          id,
          type, category_id, title, description, price_type, price_amount,
          price_unit, price_reason, location, availability, sort_order,
          territory_code, ownership_form, product_location, product_location_detail,
          commodity_group, volume_tonnes, service_all_kazakhstan
        )
        values (
          ${cardId},
          ${normalizedInput.type}, ${normalizedInput.categoryId}, ${normalizedInput.title}, ${normalizedInput.description},
          ${normalizedInput.priceType}, ${normalizedInput.priceType === "on_request" ? null : normalizedInput.priceAmount ?? null},
          ${normalizedInput.priceUnit ?? null}, ${normalizedInput.priceType === "fixed" ? null : normalizedInput.priceReason ?? null},
          ${legacyLocation}, ${normalizedInput.type === "service" ? normalizedInput.availability ?? null : null}, ${normalizedInput.sortOrder},
          ${normalizedInput.type === "product" ? normalizedInput.territoryCode ?? null : null},
          ${normalizedInput.type === "product" ? normalizedInput.ownershipForm ?? null : null},
          ${normalizedInput.type === "product" ? normalizedInput.productLocation ?? null : null},
          ${normalizedInput.type === "product" ? normalizedInput.productLocationDetail ?? null : null},
          ${normalizedInput.type === "product" ? normalizedInput.commodityGroup ?? null : null},
          ${normalizedInput.type === "product" ? normalizedInput.volumeTonnes ?? null : null},
          ${normalizedInput.type === "service" && normalizedInput.serviceAllKazakhstan}
        )
        on conflict (id) do nothing
        returning id
      `;
      if (!card) {
        replayedCardId = cardId;
        return undefined;
      }
      const createdId = card.id;

      if (normalizedInput.images.length > 0) {
        const imageRows = normalizedInput.images.map((img) => ({
          card_id: createdId,
          storage_path: img.storagePath,
          alt_text: img.altText ?? null,
          sort_order: img.sortOrder
        }));
        await tx`insert into card_images ${tx(imageRows, "card_id", "storage_path", "alt_text", "sort_order")}`;
      }
      if (normalizedInput.specs.length > 0) {
        const specRows = normalizedInput.specs.map((s) => ({
          card_id: createdId,
          key: s.key,
          value: s.value,
          sort_order: s.sortOrder
        }));
        await tx`insert into card_specs ${tx(specRows, "card_id", "key", "value", "sort_order")}`;
      }

      if (normalizedInput.type === "service" && normalizedInput.serviceTerritoryCodes.length > 0) {
        const territoryRows = normalizedInput.serviceTerritoryCodes.map((territoryCode, sortOrder) => ({
          card_id: createdId,
          territory_code: territoryCode,
          sort_order: sortOrder
        }));
        await tx`insert into card_service_territories ${tx(territoryRows, "card_id", "territory_code", "sort_order")}`;
      }

      const [detailRow] = await tx<CardRow[]>`
        select
          c.id, c.type, c.category_id, c.title, c.description, c.price_type, c.price_amount,
          c.price_unit, c.price_reason, c.location, c.availability, c.commodity_group, c.volume_tonnes,
          c.territory_code, territory.name as territory_name, territory.kind as territory_kind,
          territory.sort_order as territory_sort_order,
          c.ownership_form, c.product_location, c.product_location_detail, c.service_all_kazakhstan,
          c.sort_order, c.version, c.published_at, c.archived_at, c.created_at, c.updated_at
        from cards c
        left join territories territory on territory.code = c.territory_code
        where c.id = ${createdId}
      `;
      if (!detailRow) throw new HttpError(404, "Карточка не найдена");
      const images = await tx<CardImageRow[]>`
        select id, storage_path, alt_text, sort_order
        from card_images where card_id = ${createdId} order by sort_order
      `;
      const specs = await tx<CardSpecRow[]>`
        select id, key, value, sort_order
        from card_specs where card_id = ${createdId} order by sort_order
      `;
      const serviceTerritories = await tx<TerritoryRow[]>`
        select t.code, t.name, t.kind, t.sort_order
        from card_service_territories cst
        join territories t on t.code = cst.territory_code
        where cst.card_id = ${createdId}
        order by cst.sort_order
      `;
      const [category] = await tx<{ required_specs: string[]; is_commodity: boolean }[]>`
        select required_specs, is_commodity from categories where id = ${detailRow.category_id}
      `;
      return toAdminCardDetailWithRequiredSpecs(
        toCardDetail(detailRow, images, specs, env, serviceTerritories.map(toTerritory)),
        category?.required_specs ?? [],
        category?.is_commodity ?? false
      );
    });
    if (replayedCardId) {
      const existing = await getAdminCardDetail(env, replayedCardId);
      if (!existing || !cardMatchesCreateInput(existing, normalizedInput, legacyLocation)) {
        throw new HttpError(409, "Эта попытка создания уже использована для другой карточки", {
          code: "CARD_CREATE_REQUEST_REUSED",
        });
      }
      return existing;
    }
    if (!detail) throw new Error("Создание карточки не вернуло результат");
    return detail;
  } catch (err) {
    const mappedError = cardConstraintError(err);
    if (mappedError) throw mappedError;
    throw err;
  }
}

/**
 * Редактирование карточки — полная замена полей и списков фото/характеристик.
 * Возвращает также `storage_path` фото, отсутствующих в новом списке — их удаляет
 * вызывающий код из Storage после коммита (best-effort).
 */
export async function updateCard(
  env: AppEnv,
  id: string,
  input: UpdateCardInput
): Promise<{ detail: AdminCardDetail; removedPaths: string[] }> {
  const sql = getDb(env);
  const normalizedInput = normalizeCardInput(input);
  const legacyLocation = await legacyLocationForInput(env, normalizedInput);
  const mutationId = input.mutationId ?? crypto.randomUUID();
  const mutationPayload = cardUpdatePayload(normalizedInput, input.expectedVersion);
  try {
    const result = await sql.begin(async (tx) => {
      const [existingCard] = await tx<{
        version: number;
        published_at: Date | null;
        archived_at: Date | null;
      }[]>`
        select version, published_at, archived_at
        from cards where id = ${id}
        for update
      `;
      if (!existingCard) throw new HttpError(404, "Карточка не найдена");

      // Lock the card before checking the receipt. This serializes a replay with
      // a newer edit and lets us reject a stale receipt instead of returning the
      // newer card as if it were the original PUT result.
      const [replayedReceipt] = await tx<{
        card_id: string;
        payload: string;
        result_version: number;
      }[]>`
        select card_id, payload, result_version
        from card_update_mutations
        where mutation_id = ${mutationId}
      `;
      if (replayedReceipt) {
        if (replayedReceipt.card_id !== id || replayedReceipt.payload !== mutationPayload) {
          throw new HttpError(409, "Эта попытка изменения уже использована для другой карточки или данных", {
            code: "CARD_UPDATE_REQUEST_REUSED",
          });
        }
        if (existingCard.version !== replayedReceipt.result_version) {
          throw new HttpError(409, "Карточка уже изменена после этого сохранения. Обновите данные перед публикацией", {
            code: "CARD_CHANGED_AFTER_REPLAY",
          });
        }
        return { replayed: true as const };
      }

      if (existingCard.version !== input.expectedVersion) {
        throw new HttpError(409, "Карточка была изменена в другом окне. Обновите данные перед сохранением");
      }

      const [category] = await tx<{ required_specs: string[]; is_commodity: boolean }[]>`
        select required_specs, is_commodity from categories
        where id = ${normalizedInput.categoryId} and type = ${normalizedInput.type}
      `;
      if (!category) throw new HttpError(400, "Категория не подходит по типу карточки");
      validateCategoryFields(normalizedInput, category.is_commodity);
      if (existingCard.published_at !== null && existingCard.archived_at === null) {
        const issues = getPublicationIssues({
          type: normalizedInput.type,
          description: normalizedInput.description,
          priceType: normalizedInput.priceType,
          priceAmount: normalizedInput.priceAmount ?? null,
          priceUnit: normalizedInput.priceUnit ?? null,
          priceReason: normalizedInput.priceReason ?? null,
          territoryCode: normalizedInput.territoryCode ?? null,
          ownershipForm: normalizedInput.ownershipForm ?? null,
          productLocation: normalizedInput.productLocation ?? null,
          categoryIsCommodity: category?.is_commodity ?? false,
          commodityGroup: normalizedInput.commodityGroup ?? null,
          volumeTonnes: normalizedInput.volumeTonnes ?? null,
          serviceAllKazakhstan: normalizedInput.serviceAllKazakhstan,
          serviceTerritoryCount: normalizedInput.serviceTerritoryCodes.length,
          availability: normalizedInput.type === "service" ? normalizedInput.availability ?? null : null,
          imageCount: normalizedInput.images.length,
          specs: normalizedInput.specs,
          requiredSpecs: category?.required_specs ?? [],
        });
        if (issues.length > 0) {
          throw new HttpError(400, `Сначала скройте карточку или исправьте: ${issues.join("; ")}`);
        }
      }

      const oldImages = await tx<{ storage_path: string }[]>`
        select storage_path from card_images where card_id = ${id}
      `;

      const [card] = await tx<CardRow[]>`
        update cards set
          type = ${normalizedInput.type},
          category_id = ${normalizedInput.categoryId},
          title = ${normalizedInput.title},
          description = ${normalizedInput.description},
          price_type = ${normalizedInput.priceType},
          price_amount = ${normalizedInput.priceType === "on_request" ? null : normalizedInput.priceAmount ?? null},
          price_unit = ${normalizedInput.priceUnit ?? null},
          price_reason = ${normalizedInput.priceType === "fixed" ? null : normalizedInput.priceReason ?? null},
          location = ${legacyLocation},
          availability = ${normalizedInput.type === "service" ? normalizedInput.availability ?? null : null},
          sort_order = ${normalizedInput.sortOrder},
          territory_code = ${normalizedInput.type === "product" ? normalizedInput.territoryCode ?? null : null},
          ownership_form = ${normalizedInput.type === "product" ? normalizedInput.ownershipForm ?? null : null},
          product_location = ${normalizedInput.type === "product" ? normalizedInput.productLocation ?? null : null},
          product_location_detail = ${normalizedInput.type === "product" ? normalizedInput.productLocationDetail ?? null : null},
          commodity_group = ${normalizedInput.type === "product" ? normalizedInput.commodityGroup ?? null : null},
          volume_tonnes = ${normalizedInput.type === "product" ? normalizedInput.volumeTonnes ?? null : null},
          service_all_kazakhstan = ${normalizedInput.type === "service" && normalizedInput.serviceAllKazakhstan}
        where id = ${id} and version = ${input.expectedVersion}
        returning
          id, type, category_id, title, description, price_type, price_amount, price_unit,
          price_reason, location, availability, commodity_group, volume_tonnes,
          territory_code, (select name from territories where code = cards.territory_code) as territory_name,
          (select kind from territories where code = cards.territory_code) as territory_kind,
          (select sort_order from territories where code = cards.territory_code) as territory_sort_order,
          ownership_form, product_location, product_location_detail, service_all_kazakhstan,
          sort_order, version, published_at, archived_at, created_at, updated_at
      `;
      if (!card) {
        const [exists] = await tx<{ id: string }[]>`select id from cards where id = ${id}`;
        if (!exists) throw new HttpError(404, "Карточка не найдена");
        throw new HttpError(409, "Карточка была изменена в другом окне. Обновите данные перед сохранением");
      }

      await tx`delete from card_images where card_id = ${id}`;
      await tx`delete from card_specs where card_id = ${id}`;

      if (normalizedInput.images.length > 0) {
        const imageRows = normalizedInput.images.map((img) => ({
          card_id: id,
          storage_path: img.storagePath,
          alt_text: img.altText ?? null,
          sort_order: img.sortOrder
        }));
        await tx`insert into card_images ${tx(imageRows, "card_id", "storage_path", "alt_text", "sort_order")}`;
      }
      if (normalizedInput.specs.length > 0) {
        const specRows = normalizedInput.specs.map((s) => ({
          card_id: id,
          key: s.key,
          value: s.value,
          sort_order: s.sortOrder
        }));
        await tx`insert into card_specs ${tx(specRows, "card_id", "key", "value", "sort_order")}`;
      }

      await tx`delete from card_service_territories where card_id = ${id}`;
      if (normalizedInput.type === "service" && normalizedInput.serviceTerritoryCodes.length > 0) {
        const territoryRows = normalizedInput.serviceTerritoryCodes.map((territoryCode, sortOrder) => ({
          card_id: id,
          territory_code: territoryCode,
          sort_order: sortOrder
        }));
        await tx`insert into card_service_territories ${tx(territoryRows, "card_id", "territory_code", "sort_order")}`;
      }

      const [detailRow] = await tx<CardRow[]>`
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
      `;
      if (!detailRow) throw new HttpError(404, "Карточка не найдена");
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
      const newPaths = new Set(normalizedInput.images.map((img) => img.storagePath));
      const removedPaths = oldImages.map((r) => r.storage_path).filter((p) => !newPaths.has(p));

      await tx`
        insert into card_update_mutations (mutation_id, card_id, expected_version, result_version, payload)
        values (${mutationId}, ${id}, ${input.expectedVersion}, ${card.version}, ${mutationPayload})
      `;

      return {
        detail: toAdminCardDetailWithRequiredSpecs(
          toCardDetail(detailRow, images, specs, env, serviceTerritories.map(toTerritory)),
          category?.required_specs ?? [],
          category?.is_commodity ?? false
        ),
        removedPaths
      };
    });
    if ("replayed" in result && result.replayed) {
      const replayedDetail = await getAdminCardDetail(env, id);
      if (!replayedDetail) throw new HttpError(404, "Карточка не найдена");
      return { detail: replayedDetail, removedPaths: [] };
    }
    return result;
  } catch (err) {
    if (err instanceof HttpError) throw err;
    const mappedError = cardConstraintError(err);
    if (mappedError) throw mappedError;
    throw err;
  }
}

/** Удаление карточки (каскадно чистит фото/характеристики/избранное). 404, если не найдена. */
export async function deleteCard(env: AppEnv, id: string, expectedVersion: number): Promise<string[]> {
  const sql = getDb(env);
  return sql.begin(async (tx) => {
    const images = await tx<{ storage_path: string }[]>`
      select storage_path from card_images where card_id = ${id}
    `;
    const [row] = await tx<{ id: string }[]>`
      delete from cards where id = ${id} and version = ${expectedVersion} returning id
    `;
    if (!row) {
      const [exists] = await tx<{ id: string }[]>`select id from cards where id = ${id}`;
      if (!exists) throw new HttpError(404, "Карточка не найдена");
      throw new HttpError(409, "Карточка была изменена в другом окне. Обновите данные перед удалением");
    }
    return images.map((image) => image.storage_path);
  });
}

/** Публикует черновик или повторно открывает скрытую карточку после серверной проверки. */
export async function publishCard(env: AppEnv, id: string, expectedVersion: number): Promise<AdminCardDetail> {
  const sql = getDb(env);
  await sql.begin(async (tx) => {
    const [card] = await tx<CardRow[]>`
      select
        c.id, c.type, c.category_id, c.title, c.description, c.price_type, c.price_amount,
        c.price_unit, c.price_reason, c.location, c.availability, c.commodity_group, c.volume_tonnes, c.sort_order,
        c.territory_code, c.ownership_form, c.product_location, c.service_all_kazakhstan,
        c.version, c.published_at, c.archived_at, c.created_at, c.updated_at
      from cards c where c.id = ${id}
      for update
    `;
    if (!card) throw new HttpError(404, "Карточка не найдена");
    if (card.version !== expectedVersion) {
      throw new HttpError(409, "Карточка была изменена в другом окне. Обновите данные перед публикацией");
    }

    const [category] = await tx<{ required_specs: string[]; is_commodity: boolean }[]>`
      select required_specs, is_commodity from categories where id = ${card.category_id}
    `;
    const images = await tx<{ count: string }[]>`
      select count(*) from card_images where card_id = ${id}
    `;
    const specs = await tx<{ key: string; value: string }[]>`
      select key, value from card_specs where card_id = ${id}
    `;
    const serviceTerritories = await tx<{ count: string }[]>`
      select count(*) from card_service_territories where card_id = ${id}
    `;
    const issues = getPublicationIssues({
      type: card.type,
      description: card.description,
      priceType: card.price_type,
      priceAmount: card.price_amount,
      priceUnit: card.price_unit,
      priceReason: card.price_reason,
      territoryCode: card.territory_code,
      ownershipForm: card.ownership_form,
      productLocation: card.product_location,
      categoryIsCommodity: category?.is_commodity ?? false,
      commodityGroup: card.commodity_group,
      volumeTonnes: card.volume_tonnes === null ? null : Number(card.volume_tonnes),
      serviceAllKazakhstan: card.service_all_kazakhstan,
      serviceTerritoryCount: Number(serviceTerritories[0]?.count ?? 0),
      availability: card.availability,
      imageCount: Number(images[0]?.count ?? 0),
      specs,
      requiredSpecs: category?.required_specs ?? [],
    });
    if (issues.length > 0) {
      throw new HttpError(400, `Карточка не готова к публикации: ${issues.join("; ")}`);
    }
    await tx`
      update cards set
        published_at = coalesce(published_at, now()),
        archived_at = null
      where id = ${id}
    `;
  });
  return (await getAdminCardDetail(env, id))!;
}

/** Скрывает опубликованную карточку, не превращая её обратно в черновик. */
export async function archiveCard(env: AppEnv, id: string, expectedVersion: number): Promise<AdminCardDetail> {
  const sql = getDb(env);
  const [row] = await sql<{ id: string }[]>`
    update cards set archived_at = now()
    where id = ${id} and published_at is not null and version = ${expectedVersion}
    returning id
  `;
  if (!row) {
    const [exists] = await sql<{ id: string }[]>`select id from cards where id = ${id}`;
    if (!exists) throw new HttpError(404, "Карточка не найдена");
    const [current] = await sql<{ version: number; published_at: Date | null }[]>`
      select version, published_at from cards where id = ${id}
    `;
    if (current?.version !== expectedVersion) {
      throw new HttpError(409, "Карточка была изменена в другом окне. Обновите данные перед скрытием");
    }
    throw new HttpError(409, "Черновик ещё не опубликован");
  }
  return (await getAdminCardDetail(env, id))!;
}
