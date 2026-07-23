import type { CreateRequestInput, Request as RequestDto, RequestListQuery } from "@agromarket/contracts";
import { getDb } from "../db";
import type { AppEnv } from "../env";
import { HttpError } from "../lib/errors";
import { paginateRows, type PaginatedResult } from "../lib/pagination";
import { assertUnderLimit, retryAfterSeconds } from "../lib/rateLimit";

export interface RequestRow {
  id: string;
  user_id: string;
  source: "card" | "tab" | "profile";
  card_id: string | null;
  tab_type: "product" | "service" | null;
  card_title_snapshot: string | null;
  card_price_type_snapshot: "fixed" | "from" | "on_request" | null;
  card_price_amount_snapshot: number | null;
  card_price_unit_snapshot: string | null;
  card_price_reason_snapshot: string | null;
  client_request_id: string | null;
  request_payload_hash: string | null;
  contact_name: string;
  contact_phone: string;
  contact_phone_verified: boolean;
  comment: string | null;
  status: "new" | "in_progress" | "closed";
  created_at: Date;
  updated_at: Date;
}

interface CardSnapshot {
  title: string;
  price_type: "fixed" | "from" | "on_request";
  price_amount: number | null;
  price_unit: string | null;
  price_reason: string | null;
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
    cardPriceUnitSnapshot: row.card_price_unit_snapshot,
    cardPriceReasonSnapshot: row.card_price_reason_snapshot,
    clientRequestId: row.client_request_id,
    contactName: row.contact_name,
    contactPhone: row.contact_phone,
    contactPhoneVerified: row.contact_phone_verified,
    comment: row.comment,
    status: row.status,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString()
  };
}

export async function findRequestByClientId(
  env: AppEnv,
  userId: string,
  clientRequestId: string,
): Promise<RequestRow | undefined> {
  const sql = getDb(env);
  const [row] = await sql<RequestRow[]>`
    select * from requests
    where user_id = ${userId} and client_request_id = ${clientRequestId}
  `;
  return row;
}

/**
 * Создаёт заявку. Для источника `card` снапшот названия/цены читается из карточки
 * на момент отправки; карточка должна существовать и быть опубликована.
 * Флаг подтверждённости телефона снапшотится подзапросом: совпадает ли номер
 * из формы с verified_phone пользователя на момент создания.
 */
export async function createRequest(
  env: AppEnv,
  userId: string,
  input: CreateRequestInput,
  requestPayloadHash: string,
  verifiedContactPhone: string | null,
): Promise<{ row: RequestRow; created: boolean }> {
  const sql = getDb(env);
  return sql.begin(async (tx) => {
    const [existing] = await tx<RequestRow[]>`
      select * from requests
      where user_id = ${userId} and client_request_id = ${input.clientRequestId}
    `;
    if (existing) {
      if (existing.request_payload_hash !== requestPayloadHash) {
        throw new HttpError(409, "Эта попытка отправки уже использована для другой заявки");
      }
      return { row: existing, created: false };
    }

    const [user] = await tx<{
      registered_at: Date | null;
      verified_phone: string | null;
    }[]>`
      select registered_at, verified_phone from users where id = ${userId} for update
    `;
    if (!user) throw new HttpError(404, "Пользователь не найден");

    // Конкурентная exact-повторная отправка ждала lock пользователя: победитель уже
    // мог закоммититься. Повторяем replay-check до проверки доступности карточки.
    const [committedReplay] = await tx<RequestRow[]>`
      select * from requests
      where user_id = ${userId} and client_request_id = ${input.clientRequestId}
    `;
    if (committedReplay) {
      if (committedReplay.request_payload_hash !== requestPayloadHash) {
        throw new HttpError(409, "Эта попытка отправки уже использована для другой заявки");
      }
      return { row: committedReplay, created: false };
    }

    const [rate] = await tx<{ count: string; oldest: Date | null }[]>`
      select count(*), min(created_at) as oldest from requests
      where user_id = ${userId} and created_at > now() - interval '10 minutes'
    `;
    assertUnderLimit(Number(rate?.count ?? 0), retryAfterSeconds(rate?.oldest ?? null));

    const contactPhoneVerified =
      user.verified_phone === input.contactPhone || verifiedContactPhone === input.contactPhone;

    let card: CardSnapshot | undefined;
    if (input.source === "card") {
      [card] = await tx<CardSnapshot[]>`
        select title, price_type, price_amount, price_unit, price_reason
        from cards
        where id = ${input.cardId} and published_at is not null and archived_at is null
      `;
      if (!card) throw new HttpError(409, "Объявление уже недоступно. Заявка не отправлена");
    }

    const [inserted] = await tx<RequestRow[]>`
      insert into requests (
        user_id, source, card_id, tab_type,
        card_title_snapshot, card_price_type_snapshot, card_price_amount_snapshot,
        card_price_unit_snapshot, card_price_reason_snapshot,
        client_request_id, request_payload_hash,
        contact_name, contact_phone, contact_phone_verified, comment
      ) values (
        ${userId}, ${input.source}, ${input.source === "card" ? input.cardId : null},
        ${input.source === "tab" ? input.tabType : null},
        ${card?.title ?? null}, ${card?.price_type ?? null}, ${card?.price_amount ?? null},
        ${card?.price_unit ?? null}, ${card?.price_reason ?? null},
        ${input.clientRequestId}, ${requestPayloadHash},
        ${input.contactName}, ${input.contactPhone}, ${contactPhoneVerified}, ${input.comment ?? null}
      )
      on conflict (user_id, client_request_id) where client_request_id is not null do nothing
      returning *
    `;

    if (!inserted) {
      const [replayed] = await tx<RequestRow[]>`
        select * from requests
        where user_id = ${userId} and client_request_id = ${input.clientRequestId}
      `;
      if (!replayed || replayed.request_payload_hash !== requestPayloadHash) {
        throw new HttpError(409, "Эта попытка отправки уже использована для другой заявки");
      }
      return { row: replayed, created: false };
    }

    if (user.registered_at === null) {
      await tx`
        update users set
          contact_name = ${input.contactName},
          contact_phone = ${input.contactPhone},
          verified_phone = case
            when ${verifiedContactPhone}::text = ${input.contactPhone} then ${input.contactPhone}
            else verified_phone
          end,
          registered_at = now()
        where id = ${userId}
      `;
    }
    return { row: inserted, created: true };
  });
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
    order by created_at desc, id
    limit ${query.limit + 1} offset ${query.offset}
  `;
  const items = rows.map(toRequest);
  return paginateRows(items, query.limit, query.offset);
}

/** Заявка по id (админ, деталка для deep-link из уведомления). 404, если нет. */
export async function getRequestById(env: AppEnv, id: string): Promise<RequestRow> {
  const sql = getDb(env);
  const [row] = await sql<RequestRow[]>`select * from requests where id = ${id}`;
  if (!row) {
    throw new HttpError(404, "Заявка не найдена");
  }
  return row;
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
