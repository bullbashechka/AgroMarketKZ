import type { CreateRequestInput, Request as RequestDto, RequestListQuery } from "@agromarket/contracts";
import { getDb } from "../db";
import type { AppEnv } from "../env";
import { HttpError } from "../lib/errors";
import { paginateRows, type PaginatedResult } from "../lib/pagination";

export interface RequestRow {
  id: string;
  user_id: string;
  source: "card" | "tab" | "profile";
  card_id: string | null;
  tab_type: "product" | "service" | null;
  card_title_snapshot: string | null;
  card_price_type_snapshot: "fixed" | "on_request" | null;
  card_price_amount_snapshot: number | null;
  contact_name: string;
  contact_phone: string;
  comment: string | null;
  status: "new" | "in_progress" | "closed";
  created_at: Date;
  updated_at: Date;
}

export function toRequest(row: RequestRow): RequestDto {
  return {
    id: row.id,
    userId: row.user_id,
    source: row.source,
    cardId: row.card_id,
    tabType: row.tab_type,
    cardTitleSnapshot: row.card_title_snapshot,
    cardPriceTypeSnapshot: row.card_price_type_snapshot,
    cardPriceAmountSnapshot: row.card_price_amount_snapshot,
    contactName: row.contact_name,
    contactPhone: row.contact_phone,
    comment: row.comment,
    status: row.status,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString()
  };
}

/** Число заявок пользователя за последние 10 минут — для мягкого антиспам-лимита. */
export async function countRecentRequests(env: AppEnv, userId: string): Promise<number> {
  const sql = getDb(env);
  const [row] = await sql<{ count: string }[]>`
    select count(*) from requests
    where user_id = ${userId} and created_at > now() - interval '10 minutes'
  `;
  return Number(row?.count ?? 0);
}

/**
 * Создаёт заявку. Для источника `card` снапшот названия/цены читается из карточки
 * на момент отправки; карточка должна существовать и быть опубликована.
 */
export async function createRequest(
  env: AppEnv,
  userId: string,
  input: CreateRequestInput
): Promise<RequestRow> {
  const sql = getDb(env);

  if (input.source === "card") {
    const [card] = await sql<
      { title: string; price_type: "fixed" | "on_request"; price_amount: number | null; archived_at: Date | null }[]
    >`select title, price_type, price_amount, archived_at from cards where id = ${input.cardId}`;
    if (!card) {
      throw new HttpError(404, "Карточка не найдена");
    }
    if (card.archived_at !== null) {
      throw new HttpError(409, "Карточка снята с публикации");
    }
    const [row] = await sql<RequestRow[]>`
      insert into requests (
        user_id, source, card_id, card_title_snapshot,
        card_price_type_snapshot, card_price_amount_snapshot,
        contact_name, contact_phone, comment
      ) values (
        ${userId}, 'card', ${input.cardId}, ${card.title},
        ${card.price_type}, ${card.price_amount},
        ${input.contactName}, ${input.contactPhone}, ${input.comment ?? null}
      )
      returning *
    `;
    return row!;
  }

  if (input.source === "tab") {
    const [row] = await sql<RequestRow[]>`
      insert into requests (user_id, source, tab_type, contact_name, contact_phone, comment)
      values (${userId}, 'tab', ${input.tabType}, ${input.contactName}, ${input.contactPhone}, ${input.comment ?? null})
      returning *
    `;
    return row!;
  }

  const [row] = await sql<RequestRow[]>`
    insert into requests (user_id, source, contact_name, contact_phone, comment)
    values (${userId}, 'profile', ${input.contactName}, ${input.contactPhone}, ${input.comment ?? null})
    returning *
  `;
  return row!;
}

/** Список заявок (админ), с фильтром по статусу и постраничной выдачей. */
export async function listRequests(
  env: AppEnv,
  query: RequestListQuery
): Promise<PaginatedResult<RequestDto>> {
  const sql = getDb(env);
  const rows = await sql<RequestRow[]>`
    select * from requests
    where (${query.status ?? null}::request_status is null or status = ${query.status ?? null}::request_status)
    order by created_at desc
    limit ${query.limit + 1} offset ${query.offset}
  `;
  const items = rows.map(toRequest);
  return paginateRows(items, query.limit, query.offset);
}

/** Смена статуса заявки (админ). Переходы свободные. 404, если заявки нет. */
export async function updateRequestStatus(
  env: AppEnv,
  id: string,
  status: "new" | "in_progress" | "closed"
): Promise<RequestRow> {
  const sql = getDb(env);
  const [row] = await sql<RequestRow[]>`
    update requests set status = ${status} where id = ${id} returning *
  `;
  if (!row) {
    throw new HttpError(404, "Заявка не найдена");
  }
  return row;
}
