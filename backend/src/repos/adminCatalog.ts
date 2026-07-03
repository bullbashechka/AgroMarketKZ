import type {
  AdminCardListItem,
  AdminCardListQuery,
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
import { escapeLike } from "../lib/search";
import {
  type CardImageRow,
  type CardListRow,
  type CardRow,
  type CardSpecRow,
  type CategoryRow,
  toCardDetail,
  toCardListItem,
  toCategory
} from "./catalog";

function isPgError(err: unknown, code: string): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === code;
}

/** Все категории вкладки (включая неактивные) — для админ-списка. */
export async function listCategoriesAdmin(env: AppEnv, type: CatalogType): Promise<Category[]> {
  const sql = getDb(env);
  const rows = await sql<CategoryRow[]>`
    select id, type, name, sort_order, is_active, created_at, updated_at
    from categories
    where type = ${type}
    order by sort_order, name
  `;
  return rows.map(toCategory);
}

/** Создание категории. 409, если активная категория с таким названием уже есть. */
export async function createCategory(env: AppEnv, input: CreateCategoryInput): Promise<Category> {
  const sql = getDb(env);
  try {
    const [row] = await sql<CategoryRow[]>`
      insert into categories (type, name, sort_order)
      values (${input.type}, ${input.name}, ${input.sortOrder})
      returning id, type, name, sort_order, is_active, created_at, updated_at
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
  const columns: Record<string, string | number> = {};
  if (input.name !== undefined) columns.name = input.name;
  if (input.sortOrder !== undefined) columns.sort_order = input.sortOrder;

  const keys = Object.keys(columns);
  if (keys.length === 0) {
    const [row] = await sql<CategoryRow[]>`
      select id, type, name, sort_order, is_active, created_at, updated_at
      from categories where id = ${id}
    `;
    if (!row) throw new HttpError(404, "Категория не найдена");
    return toCategory(row);
  }

  try {
    const [row] = await sql<CategoryRow[]>`
      update categories set ${sql(columns, ...keys)}
      where id = ${id}
      returning id, type, name, sort_order, is_active, created_at, updated_at
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
  sort_order: number;
  archived_at: Date | null;
  updated_at: Date;
}

function toAdminCardListItem(row: AdminCardListRow, env: AppEnv): AdminCardListItem {
  return {
    ...toCardListItem(row, env),
    sortOrder: row.sort_order,
    archivedAt: row.archived_at ? row.archived_at.toISOString() : null,
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
      c.id, c.type, c.category_id, c.title, c.price_type, c.price_amount,
      c.sort_order, c.archived_at, c.updated_at,
      img.storage_path as first_image_path,
      spec.key as first_spec_key, spec.value as first_spec_value
    from cards c
    left join lateral (
      select storage_path from card_images where card_id = c.id order by sort_order limit 1
    ) img on true
    left join lateral (
      select key, value from card_specs where card_id = c.id order by sort_order limit 1
    ) spec on true
    where (${query.type ?? null}::catalog_type is null or c.type = ${query.type ?? null}::catalog_type)
      and (${query.categoryId ?? null}::uuid is null or c.category_id = ${query.categoryId ?? null}::uuid)
      and (${searchPattern}::text is null or c.title ilike ${searchPattern})
      and (${archivedFilter}::boolean is null or (c.archived_at is not null) = ${archivedFilter}::boolean)
    order by c.sort_order, c.title
    limit ${query.limit + 1} offset ${query.offset}
  `;
  const items = rows.map((row) => toAdminCardListItem(row, env));
  return paginateRows(items, query.limit, query.offset);
}

/** Создание карточки со всеми полями (изображения + характеристики) в транзакции. */
export async function createCard(env: AppEnv, input: CreateCardInput): Promise<CardDetail> {
  const sql = getDb(env);
  try {
    return await sql.begin(async (tx) => {
      const [card] = await tx<CardRow[]>`
        insert into cards (type, category_id, title, description, price_type, price_amount, sort_order)
        values (
          ${input.type}, ${input.categoryId}, ${input.title}, ${input.description},
          ${input.priceType}, ${input.priceType === "fixed" ? input.priceAmount : null}, ${input.sortOrder}
        )
        returning
          id, type, category_id, title, description, price_type, price_amount,
          sort_order, archived_at, created_at, updated_at
      `;
      const cardId = card!.id;

      if (input.images.length > 0) {
        const imageRows = input.images.map((img) => ({
          card_id: cardId,
          storage_path: img.storagePath,
          alt_text: img.altText ?? null,
          sort_order: img.sortOrder
        }));
        await tx`insert into card_images ${tx(imageRows, "card_id", "storage_path", "alt_text", "sort_order")}`;
      }
      if (input.specs.length > 0) {
        const specRows = input.specs.map((s) => ({
          card_id: cardId,
          key: s.key,
          value: s.value,
          sort_order: s.sortOrder
        }));
        await tx`insert into card_specs ${tx(specRows, "card_id", "key", "value", "sort_order")}`;
      }

      const images = await tx<CardImageRow[]>`
        select id, storage_path, alt_text, sort_order from card_images
        where card_id = ${cardId} order by sort_order
      `;
      const specs = await tx<CardSpecRow[]>`
        select id, key, value, sort_order from card_specs
        where card_id = ${cardId} order by sort_order
      `;
      return toCardDetail(card!, images, specs, env);
    });
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
): Promise<{ detail: CardDetail; removedPaths: string[] }> {
  const sql = getDb(env);
  try {
    return await sql.begin(async (tx) => {
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
          price_amount = ${input.priceType === "fixed" ? input.priceAmount : null},
          sort_order = ${input.sortOrder}
        where id = ${id}
        returning
          id, type, category_id, title, description, price_type, price_amount,
          sort_order, archived_at, created_at, updated_at
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

      const images = await tx<CardImageRow[]>`
        select id, storage_path, alt_text, sort_order from card_images
        where card_id = ${id} order by sort_order
      `;
      const specs = await tx<CardSpecRow[]>`
        select id, key, value, sort_order from card_specs
        where card_id = ${id} order by sort_order
      `;

      const newPaths = new Set(input.images.map((img) => img.storagePath));
      const removedPaths = oldImages.map((r) => r.storage_path).filter((p) => !newPaths.has(p));

      return { detail: toCardDetail(card, images, specs, env), removedPaths };
    });
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

/** Скрывает/публикует карточку (флаг `archivedAt`). 404, если не найдена. */
export async function setCardArchived(env: AppEnv, id: string, archived: boolean): Promise<void> {
  const sql = getDb(env);
  const rows = archived
    ? await sql<{ id: string }[]>`update cards set archived_at = now() where id = ${id} returning id`
    : await sql<{ id: string }[]>`update cards set archived_at = null where id = ${id} returning id`;
  if (!rows[0]) {
    throw new HttpError(404, "Карточка не найдена");
  }
}
