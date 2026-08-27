import type {
  AdminCategory,
  CatalogType,
  Category,
  CreateCategoryInput,
  UpdateCategoryInput,
} from "@agromarket/contracts";
import type { Database } from "../db";
import type { AppEnv } from "../env";
import { HttpError } from "../lib/errors";
import { normalizeCatalogText } from "../lib/search";
import { appendAdminAuditIntent, type AdminAuditInput } from "./adminAudit";
import { type CategoryRow, toCategory } from "./catalog";

function isPgError(err: unknown, code: string): boolean {
  return typeof err === "object" && err !== null && String((err as { code?: unknown }).code) === code;
}

interface AdminCategoryRow extends CategoryRow {
  card_count: number;
  active_card_count: number;
}

function toAdminCategory(row: AdminCategoryRow): AdminCategory {
  return {
    ...toCategory(row),
    cardCount: row.card_count,
    activeCardCount: row.active_card_count,
  };
}

/** Все категории вкладки, включая неактивные, со счётчиками карточек для админ-списка. */
export async function listCategoriesAdmin(env: AppEnv, type: CatalogType, db: Database): Promise<AdminCategory[]> {
  const sql = db.sql;
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
export async function createCategory(
  env: AppEnv,
  input: CreateCategoryInput,
  db: Database,
  audit?: AdminAuditInput,
): Promise<Category> {
  const sql = db.sql;
  const name = normalizeCatalogText(input.name);
  try {
    return await sql.begin(async (tx) => {
      const [row] = await tx<CategoryRow[]>`
        insert into categories (type, name, sort_order, is_commodity, required_specs)
        values (${input.type}, ${name}, ${input.sortOrder}, ${input.type === "product" && input.isCommodity}, ${input.requiredSpecs.map(normalizeCatalogText)})
        returning id, type, name, sort_order, is_active, is_commodity, required_specs, created_at, updated_at
      `;
      if (audit) await appendAdminAuditIntent(tx, audit);
      return toCategory(row!);
    });
  } catch (err) {
    if (isPgError(err, "23505")) throw new HttpError(409, "Категория с таким названием уже есть");
    throw err;
  }
}

/** Переименование, перемещение и требования категории. Тип не меняется. */
export async function updateCategory(
  env: AppEnv,
  id: string,
  input: UpdateCategoryInput,
  db: Database,
  audit?: AdminAuditInput,
): Promise<Category> {
  const sql = db.sql;
  const columns: Record<string, string | number | boolean | string[]> = {};
  if (input.name !== undefined) columns.name = normalizeCatalogText(input.name);
  if (input.sortOrder !== undefined) columns.sort_order = input.sortOrder;
  if (input.requiredSpecs !== undefined) columns.required_specs = input.requiredSpecs.map(normalizeCatalogText);
  if (input.isCommodity !== undefined) columns.is_commodity = input.isCommodity;
  const keys = Object.keys(columns);

  if (keys.length === 0) {
    return sql.begin(async (tx) => {
      const [row] = await tx<CategoryRow[]>`
        select id, type, name, sort_order, is_active, is_commodity, required_specs, created_at, updated_at
        from categories where id = ${id}
      `;
      if (!row) throw new HttpError(404, "Категория не найдена");
      if (audit) await appendAdminAuditIntent(tx, audit);
      return toCategory(row);
    });
  }

  try {
    return await sql.begin(async (tx) => {
      const [current] = await tx<{ type: CatalogType; is_commodity: boolean }[]>`
        select type, is_commodity from categories where id = ${id}
        for update
      `;
      if (!current) throw new HttpError(404, "Категория не найдена");
      if (current.type === "service" && input.isCommodity) {
        throw new HttpError(400, "Группа продукции доступна только для товарной категории");
      }
      if (input.isCommodity !== undefined && current.is_commodity !== input.isCommodity) {
        const [active] = await tx<{ count: string }[]>`
          select count(*) from cards
          where category_id = ${id} and published_at is not null and archived_at is null
        `;
        if (Number(active?.count ?? 0) > 0) {
          throw new HttpError(409, "Сначала скройте опубликованные карточки в категории, затем измените признак товарной категории");
        }
      }
      const [row] = await tx<CategoryRow[]>`
        update categories set ${tx(columns, ...keys)}
        where id = ${id}
        returning id, type, name, sort_order, is_active, is_commodity, required_specs, created_at, updated_at
      `;
      if (!row) throw new HttpError(404, "Категория не найдена");
      if (audit) await appendAdminAuditIntent(tx, audit);
      return toCategory(row);
    });
  } catch (err) {
    if (isPgError(err, "23505")) throw new HttpError(409, "Категория с таким названием уже есть");
    throw err;
  }
}

/** Удаление категории. Запрещено, пока в ней есть карточки. */
export async function deleteCategory(
  env: AppEnv,
  id: string,
  db: Database,
  audit?: AdminAuditInput,
): Promise<void> {
  const sql = db.sql;
  try {
    await sql.begin(async (tx) => {
      const [count] = await tx<{ count: string }[]>`select count(*) from cards where category_id = ${id}`;
      if (Number(count?.count ?? 0) > 0) throw new HttpError(409, "Нельзя удалить категорию, пока в ней есть карточки");
      const [row] = await tx<{ id: string }[]>`delete from categories where id = ${id} returning id`;
      if (!row) throw new HttpError(404, "Категория не найдена");
      if (audit) await appendAdminAuditIntent(tx, audit);
    });
  } catch (err) {
    if (err instanceof HttpError) throw err;
    if (isPgError(err, "23503")) throw new HttpError(409, "Нельзя удалить категорию, пока в ней есть карточки");
    throw err;
  }
}
