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
import { escapeLike } from "../lib/search";
import {
  type CardListRow,
  type CardRow,
  type CategoryRow,
  toCardListItem,
  toCategory,
  getCardByIdAdmin,
} from "./catalog";

function isPgError(err: unknown, code: string): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === code;
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
      cat.id, cat.type, cat.name, cat.sort_order, cat.is_active, cat.created_at, cat.updated_at,
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
  try {
    const [row] = await sql<CategoryRow[]>`
      insert into categories (type, name, sort_order, required_specs)
      values (${input.type}, ${input.name}, ${input.sortOrder}, ${input.requiredSpecs})
      returning id, type, name, sort_order, is_active, required_specs, created_at, updated_at
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
  const columns: Record<string, string | number | string[]> = {};
  if (input.name !== undefined) columns.name = input.name;
  if (input.sortOrder !== undefined) columns.sort_order = input.sortOrder;
  if (input.requiredSpecs !== undefined) columns.required_specs = input.requiredSpecs;

  const keys = Object.keys(columns);
  if (keys.length === 0) {
    const [row] = await sql<CategoryRow[]>`
      select id, type, name, sort_order, is_active, required_specs, created_at, updated_at
      from categories where id = ${id}
    `;
    if (!row) throw new HttpError(404, "Категория не найдена");
    return toCategory(row);
  }

  try {
    const [row] = await sql<CategoryRow[]>`
      update categories set ${sql(columns, ...keys)}
      where id = ${id}
      returning id, type, name, sort_order, is_active, required_specs, created_at, updated_at
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
}

function toAdminCardListItem(row: AdminCardListRow, env: AppEnv): AdminCardListItem {
  const reviewIssues = getPublicationIssues({
    description: row.description,
    priceType: row.price_type,
    priceAmount: row.price_amount,
    priceUnit: row.price_unit,
    priceReason: row.price_reason,
    location: row.location,
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
  const searchPattern = query.search ? `%${escapeLike(query.search)}%` : null;
  const archivedFilter = query.archived === "active" ? false : query.archived === "archived" ? true : null;
  const rows = await sql<AdminCardListRow[]>`
    select
      c.id, c.type, c.category_id, c.title, c.description, c.price_type, c.price_amount,
      c.price_unit, c.price_reason, c.location, c.availability,
      c.sort_order, c.published_at, c.archived_at, c.updated_at,
      cat.required_specs,
      img.first_image_path, img.image_count,
      spec.first_spec_key, spec.first_spec_value, spec.spec_keys
    from cards c
    join categories cat on cat.id = c.category_id
    left join lateral (
      select
        (array_agg(storage_path order by sort_order))[1] as first_image_path,
        count(*)::int as image_count
      from card_images where card_id = c.id
    ) img on true
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

async function toAdminCardDetail(env: AppEnv, detail: CardDetail): Promise<AdminCardDetail> {
  const sql = getDb(env);
  const [category] = await sql<{ required_specs: string[] }[]>`
    select required_specs from categories where id = ${detail.categoryId}
  `;
  const reviewIssues = getPublicationIssues({
    description: detail.description,
    priceType: detail.priceType,
    priceAmount: detail.priceAmount,
    priceUnit: detail.priceUnit,
    priceReason: detail.priceReason,
    location: detail.location,
    availability: detail.availability,
    imageCount: detail.images.length,
    specs: detail.specs,
    requiredSpecs: category?.required_specs ?? [],
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

export async function getAdminCardDetail(env: AppEnv, id: string): Promise<AdminCardDetail | undefined> {
  const detail = await getCardByIdAdmin(env, id);
  return detail ? toAdminCardDetail(env, detail) : undefined;
}

/** Создаёт серверный черновик вместе с уже успешно загруженными фото и характеристиками. */
export async function createCard(env: AppEnv, input: CreateCardInput): Promise<AdminCardDetail> {
  const sql = getDb(env);
  try {
    const cardId = await sql.begin(async (tx) => {
      const [card] = await tx<CardRow[]>`
        insert into cards (
          type, category_id, title, description, price_type, price_amount,
          price_unit, price_reason, location, availability, sort_order
        )
        values (
          ${input.type}, ${input.categoryId}, ${input.title}, ${input.description},
          ${input.priceType}, ${input.priceType === "on_request" ? null : input.priceAmount ?? null},
          ${input.priceUnit ?? null}, ${input.priceType === "fixed" ? null : input.priceReason ?? null},
          ${input.location ?? null}, ${input.availability ?? null}, ${input.sortOrder}
        )
        returning
          id, type, category_id, title, description, price_type, price_amount, price_unit,
          price_reason, location, availability, sort_order, published_at, archived_at,
          created_at, updated_at
      `;
      const createdId = card!.id;

      if (input.images.length > 0) {
        const imageRows = input.images.map((img) => ({
          card_id: createdId,
          storage_path: img.storagePath,
          alt_text: img.altText ?? null,
          sort_order: img.sortOrder
        }));
        await tx`insert into card_images ${tx(imageRows, "card_id", "storage_path", "alt_text", "sort_order")}`;
      }
      if (input.specs.length > 0) {
        const specRows = input.specs.map((s) => ({
          card_id: createdId,
          key: s.key,
          value: s.value,
          sort_order: s.sortOrder
        }));
        await tx`insert into card_specs ${tx(specRows, "card_id", "key", "value", "sort_order")}`;
      }

      return createdId;
    });
    return (await getAdminCardDetail(env, cardId))!;
  } catch (err) {
    if (isPgError(err, "23503")) {
      throw new HttpError(400, "Категория не подходит по типу карточки");
    }
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
  try {
    const result = await sql.begin(async (tx) => {
      const oldImages = await tx<{ storage_path: string }[]>`
        select storage_path from card_images where card_id = ${id}
      `;

      const [card] = await tx<CardRow[]>`
        update cards set
          type = ${input.type},
          category_id = ${input.categoryId},
          title = ${input.title},
          description = ${input.description},
          price_type = ${input.priceType},
          price_amount = ${input.priceType === "on_request" ? null : input.priceAmount ?? null},
          price_unit = ${input.priceUnit ?? null},
          price_reason = ${input.priceType === "fixed" ? null : input.priceReason ?? null},
          location = ${input.location ?? null},
          availability = ${input.availability ?? null},
          sort_order = ${input.sortOrder}
        where id = ${id}
        returning
          id, type, category_id, title, description, price_type, price_amount, price_unit,
          price_reason, location, availability, sort_order, published_at, archived_at,
          created_at, updated_at
      `;
      if (!card) {
        throw new HttpError(404, "Карточка не найдена");
      }

      await tx`delete from card_images where card_id = ${id}`;
      await tx`delete from card_specs where card_id = ${id}`;

      if (input.images.length > 0) {
        const imageRows = input.images.map((img) => ({
          card_id: id,
          storage_path: img.storagePath,
          alt_text: img.altText ?? null,
          sort_order: img.sortOrder
        }));
        await tx`insert into card_images ${tx(imageRows, "card_id", "storage_path", "alt_text", "sort_order")}`;
      }
      if (input.specs.length > 0) {
        const specRows = input.specs.map((s) => ({
          card_id: id,
          key: s.key,
          value: s.value,
          sort_order: s.sortOrder
        }));
        await tx`insert into card_specs ${tx(specRows, "card_id", "key", "value", "sort_order")}`;
      }

      const [category] = await tx<{ required_specs: string[] }[]>`
        select required_specs from categories where id = ${input.categoryId}
      `;
      const issues = getPublicationIssues({
        description: card.description,
        priceType: card.price_type,
        priceAmount: card.price_amount,
        priceUnit: card.price_unit,
        priceReason: card.price_reason,
        location: card.location,
        availability: card.availability,
        imageCount: input.images.length,
        specs: input.specs,
        requiredSpecs: category?.required_specs ?? [],
      });
      if (card.published_at !== null && card.archived_at === null && issues.length > 0) {
        throw new HttpError(400, `Сначала скройте карточку или исправьте: ${issues.join("; ")}`);
      }

      const newPaths = new Set(input.images.map((img) => img.storagePath));
      const removedPaths = oldImages.map((r) => r.storage_path).filter((p) => !newPaths.has(p));

      return { removedPaths };
    });
    return { detail: (await getAdminCardDetail(env, id))!, removedPaths: result.removedPaths };
  } catch (err) {
    if (err instanceof HttpError) throw err;
    if (isPgError(err, "23503")) {
      throw new HttpError(400, "Категория не подходит по типу карточки");
    }
    throw err;
  }
}

/** Удаление карточки (каскадно чистит фото/характеристики/избранное). 404, если не найдена. */
export async function deleteCard(env: AppEnv, id: string): Promise<string[]> {
  const sql = getDb(env);
  const images = await sql<{ storage_path: string }[]>`
    select storage_path from card_images where card_id = ${id}
  `;
  const [row] = await sql<{ id: string }[]>`delete from cards where id = ${id} returning id`;
  if (!row) {
    throw new HttpError(404, "Карточка не найдена");
  }
  return images.map((r) => r.storage_path);
}

/** Публикует черновик или повторно открывает скрытую карточку после серверной проверки. */
export async function publishCard(env: AppEnv, id: string): Promise<AdminCardDetail> {
  const sql = getDb(env);
  await sql.begin(async (tx) => {
    const [card] = await tx<CardRow[]>`
      select
        c.id, c.type, c.category_id, c.title, c.description, c.price_type, c.price_amount,
        c.price_unit, c.price_reason, c.location, c.availability, c.sort_order,
        c.published_at, c.archived_at, c.created_at, c.updated_at
      from cards c where c.id = ${id}
      for update
    `;
    if (!card) throw new HttpError(404, "Карточка не найдена");

    const [category] = await tx<{ required_specs: string[] }[]>`
      select required_specs from categories where id = ${card.category_id}
    `;
    const images = await tx<{ count: string }[]>`
      select count(*) from card_images where card_id = ${id}
    `;
    const specs = await tx<{ key: string; value: string }[]>`
      select key, value from card_specs where card_id = ${id}
    `;
    const issues = getPublicationIssues({
      description: card.description,
      priceType: card.price_type,
      priceAmount: card.price_amount,
      priceUnit: card.price_unit,
      priceReason: card.price_reason,
      location: card.location,
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
export async function archiveCard(env: AppEnv, id: string): Promise<AdminCardDetail> {
  const sql = getDb(env);
  const [row] = await sql<{ id: string }[]>`
    update cards set archived_at = now()
    where id = ${id} and published_at is not null
    returning id
  `;
  if (!row) {
    const [exists] = await sql<{ id: string }[]>`select id from cards where id = ${id}`;
    if (!exists) throw new HttpError(404, "Карточка не найдена");
    throw new HttpError(409, "Черновик ещё не опубликован");
  }
  return (await getAdminCardDetail(env, id))!;
}
