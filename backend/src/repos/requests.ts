import type {
  CreateRequestInput,
  ListingSubmission,
  Request as RequestDto,
  RequestListQuery,
  Territory,
  CommodityGroup,
} from "@agromarket/contracts";
import type { Database } from "../db";
import type { AppEnv } from "../env";
import { HttpError } from "../lib/errors";
import { paginateRows, type PaginatedResult } from "../lib/pagination";
import { assertUnderLimit, retryAfterSeconds } from "../lib/rateLimit";
import { appendAdminAuditIntent, type AdminAuditInput } from "./adminAudit";

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
  listing_submission_type: "product" | "service" | null;
  submission_category_id: string | null;
  submission_category_name_snapshot: string | null;
  submission_territory_code: string | null;
  submission_ownership_form: "peasant_farm" | "llp_vat_agricultural_producer" | "llp_trader" | null;
  submission_product_location: "elevator" | "seller_site" | null;
  submission_product_location_detail: string | null;
  submission_commodity_group: CommodityGroup | null;
  submission_volume_tonnes: number | string | null;
  submission_all_kazakhstan: boolean;
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

interface TerritoryRow {
  code: Territory["code"];
  name: string;
  kind: Territory["kind"];
  sort_order: number;
}

interface RequestTerritoryRow extends TerritoryRow {
  request_id: string;
  relation_sort_order: number;
}

function toTerritory(row: TerritoryRow): Territory {
  return { code: row.code, name: row.name, kind: row.kind, sortOrder: row.sort_order };
}

async function getListingSubmission(
  env: AppEnv,
  row: RequestRow,
  db: Database,
  prefetchedTerritories?: Territory[]
): Promise<ListingSubmission | null> {
  if (!row.listing_submission_type || !row.submission_category_name_snapshot) return null;
  const sql = db.sql;
  if (row.listing_submission_type === "product") {
    if (!row.submission_territory_code || !row.submission_ownership_form) {
      return null;
    }
    const territory = prefetchedTerritories
      ? prefetchedTerritories[0]
      : (await sql<TerritoryRow[]>`
          select code, name, kind, sort_order from territories where code = ${row.submission_territory_code}
        `)[0];
    if (!territory) return null;
    return {
      type: "product",
      categoryId: row.submission_category_id,
      categoryName: row.submission_category_name_snapshot,
      territory: "sortOrder" in territory ? territory : toTerritory(territory),
      ownershipForm: row.submission_ownership_form,
      commodityGroup: row.submission_commodity_group,
      volumeTonnes: row.submission_volume_tonnes === null ? null : Number(row.submission_volume_tonnes),
      productLocation: row.submission_product_location,
      productLocationDetail: row.submission_product_location_detail
    };
  }

  const territories = prefetchedTerritories ?? (await sql<TerritoryRow[]>`
    select t.code, t.name, t.kind, t.sort_order
    from request_service_territories rst
    join territories t on t.code = rst.territory_code
    where rst.request_id = ${row.id}
    order by rst.sort_order
  `).map(toTerritory);
  return {
    type: "service",
    categoryId: row.submission_category_id,
    categoryName: row.submission_category_name_snapshot,
    allKazakhstan: row.submission_all_kazakhstan,
    territories
  };
}

export async function toRequest(
  env: AppEnv,
  row: RequestRow,
  db: Database,
  prefetchedTerritories?: Territory[]
): Promise<RequestDto> {
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
    listingSubmission: await getListingSubmission(env, row, db, prefetchedTerritories),
    status: row.status,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString()
  };
}

export async function findRequestByClientId(
  env: AppEnv,
  userId: string,
  clientRequestId: string,
  db: Database,
): Promise<RequestRow | undefined> {
  const sql = db.sql;
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
  db: Database,
): Promise<{ row: RequestRow; created: boolean }> {
  const sql = db.sql;
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

    const listingSubmission = input.source === "tab" ? input.listingSubmission : undefined;
    let categoryName: string | null = null;
    if (listingSubmission) {
      const [category] = await tx<{ name: string; is_commodity: boolean }[]>`
        select name, is_commodity from categories
        where id = ${listingSubmission.categoryId}
          and type = ${listingSubmission.type}
          and is_active
      `;
      if (!category) {
        throw new HttpError(400, "Выбранная категория больше недоступна");
      }
      if (listingSubmission.type === "product") {
        const hasCommodityFields = listingSubmission.commodityGroup != null || listingSubmission.volumeTonnes != null;
        if (category.is_commodity) {
          if (!listingSubmission.commodityGroup || listingSubmission.volumeTonnes == null || !listingSubmission.productLocation) {
            throw new HttpError(400, "Для этой категории укажите группу, объём и местонахождение товара");
          }
        } else if (hasCommodityFields) {
          throw new HttpError(400, "Выбранная категория не использует группу и объём товара");
        }
      }
      categoryName = category.name;
    }

    const [inserted] = await tx<RequestRow[]>`
      insert into requests (
        user_id, source, card_id, tab_type,
        card_title_snapshot, card_price_type_snapshot, card_price_amount_snapshot,
        card_price_unit_snapshot, card_price_reason_snapshot,
        client_request_id, request_payload_hash,
        contact_name, contact_phone, contact_phone_verified, comment,
        listing_submission_type, submission_category_id, submission_category_name_snapshot,
        submission_territory_code, submission_ownership_form, submission_product_location,
        submission_product_location_detail, submission_commodity_group, submission_volume_tonnes,
        submission_all_kazakhstan
      ) values (
        ${userId}, ${input.source}, ${input.source === "card" ? input.cardId : null},
        ${input.source === "tab" ? input.tabType : null},
        ${card?.title ?? null}, ${card?.price_type ?? null}, ${card?.price_amount ?? null},
        ${card?.price_unit ?? null}, ${card?.price_reason ?? null},
        ${input.clientRequestId}, ${requestPayloadHash},
        ${input.contactName}, ${input.contactPhone}, ${contactPhoneVerified}, ${input.comment ?? null},
        ${listingSubmission?.type ?? null}, ${listingSubmission?.categoryId ?? null}, ${categoryName},
        ${listingSubmission?.type === "product" ? listingSubmission.territoryCode : null},
        ${listingSubmission?.type === "product" ? listingSubmission.ownershipForm : null},
        ${listingSubmission?.type === "product" ? listingSubmission.productLocation ?? null : null},
        ${listingSubmission?.type === "product" ? listingSubmission.productLocationDetail ?? null : null},
        ${listingSubmission?.type === "product" ? listingSubmission.commodityGroup ?? null : null},
        ${listingSubmission?.type === "product" ? listingSubmission.volumeTonnes ?? null : null},
        ${listingSubmission?.type === "service" && listingSubmission.allKazakhstan}
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

    if (listingSubmission?.type === "service" && listingSubmission.territoryCodes.length > 0) {
      const territoryRows = listingSubmission.territoryCodes.map((territoryCode, sortOrder) => ({
        request_id: inserted.id,
        territory_code: territoryCode,
        sort_order: sortOrder
      }));
      await tx`insert into request_service_territories ${tx(territoryRows, "request_id", "territory_code", "sort_order")}`;
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
    await tx`
      insert into app_private.notification_outbox (event_type, request_id)
      values ('request', ${inserted.id})
      on conflict (request_id) where request_id is not null do nothing
    `;
    return { row: inserted, created: true };
  });
}

/** Список заявок (админ), с фильтром по статусу и постраничной выдачей. */
export async function listRequests(
  env: AppEnv,
  query: RequestListQuery,
  db: Database,
): Promise<PaginatedResult<RequestDto>> {
  const sql = db.sql;
  const rows = await sql<RequestRow[]>`
    select * from requests
    where (${query.status ?? null}::request_status is null or status = ${query.status ?? null}::request_status)
    order by created_at desc, id
    limit ${query.limit + 1} offset ${query.offset}
  `;
  const structuredRequestIds = rows
    .filter((row) => row.listing_submission_type !== null)
    .map((row) => row.id);
  const territoryRows = structuredRequestIds.length === 0
    ? []
    : await sql<RequestTerritoryRow[]>`
        select
          r.id as request_id,
          t.code, t.name, t.kind, t.sort_order,
          0 as relation_sort_order
        from requests r
        join territories t on t.code = r.submission_territory_code
        where r.id = any(${structuredRequestIds}::uuid[])
          and r.listing_submission_type = 'product'
        union all
        select
          rst.request_id,
          t.code, t.name, t.kind, t.sort_order,
          rst.sort_order as relation_sort_order
        from request_service_territories rst
        join territories t on t.code = rst.territory_code
        where rst.request_id = any(${structuredRequestIds}::uuid[])
        order by request_id, relation_sort_order
      `;
  const territoriesByRequest = new Map<string, Territory[]>();
  for (const row of territoryRows) {
    const territories = territoriesByRequest.get(row.request_id) ?? [];
    territories.push(toTerritory(row));
    territoriesByRequest.set(row.request_id, territories);
  }
  const items = await Promise.all(rows.map((row) => toRequest(
    env,
    row,
    db,
    row.listing_submission_type ? territoriesByRequest.get(row.id) ?? [] : undefined
  )));
  return paginateRows(items, query.limit, query.offset);
}

/** Заявка по id (админ, деталка для deep-link из уведомления). 404, если нет. */
export async function getRequestById(env: AppEnv, id: string, db: Database): Promise<RequestRow> {
  const sql = db.sql;
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
  status: "new" | "in_progress" | "closed",
  db: Database,
  audit?: AdminAuditInput,
): Promise<RequestRow> {
  const sql = db.sql;
  return sql.begin(async (tx) => {
    const [row] = await tx<RequestRow[]>`
      update requests set status = ${status} where id = ${id} returning *
    `;
    if (!row) throw new HttpError(404, "Заявка не найдена");
    if (audit) await appendAdminAuditIntent(tx, audit);
    return row;
  });
}
