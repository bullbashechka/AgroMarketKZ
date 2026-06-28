import { z } from "zod";
import { REQUEST_COMMENT_MAX } from "./constants";
import {
  catalogTypeSchema,
  priceTypeSchema,
  requestSourceSchema,
  requestStatusSchema
} from "./enums";
import { paginated, paginationQuerySchema } from "./pagination";
import { contactNameSchema, optionalText } from "./primitives";
import { kzPhoneSchema } from "./phone";

/** Заявка (ответ API). Snapshot-поля хранят данные карточки на момент создания заявки. */
export const requestSchema = z.object({
  id: z.uuid(),
  userId: z.uuid(),
  source: requestSourceSchema,
  cardId: z.uuid().nullable(),
  tabType: catalogTypeSchema.nullable(),
  cardTitleSnapshot: z.string().nullable(),
  cardPriceTypeSnapshot: priceTypeSchema.nullable(),
  cardPriceAmountSnapshot: z.number().int().nullable(),
  contactName: z.string(),
  contactPhone: z.string(),
  comment: z.string().nullable(),
  status: requestStatusSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime()
});

export type Request = z.infer<typeof requestSchema>;

// Контактные поля общие для всех источников. Имя и телефон предзаполняются из профиля,
// но всё равно валидируются на отправке.
const contactFields = {
  contactName: contactNameSchema,
  contactPhone: kzPhoneSchema,
  comment: optionalText(REQUEST_COMMENT_MAX)
};

/**
 * Создание заявки. Форма зависит от источника (snapshot карточки заполняет backend):
 * - `card` → нужен `cardId`;
 * - `tab` → нужен `tabType` (с какой вкладки);
 * - `profile` → только контакты.
 */
export const createRequestInput = z.discriminatedUnion("source", [
  z.object({
    source: z.literal("card"),
    cardId: z.uuid({ error: "Не указана карточка" }),
    ...contactFields
  }),
  z.object({
    source: z.literal("tab"),
    tabType: catalogTypeSchema,
    ...contactFields
  }),
  z.object({
    source: z.literal("profile"),
    ...contactFields
  })
]);

export type CreateRequestInput = z.infer<typeof createRequestInput>;

/** Смена статуса заявки (админ). */
export const updateRequestStatusInput = z.object({
  status: requestStatusSchema
});

export type UpdateRequestStatusInput = z.infer<typeof updateRequestStatusInput>;

/** Список заявок (админ), фильтр по статусу. */
export const requestListQuery = paginationQuerySchema.extend({
  status: requestStatusSchema.optional()
});

export type RequestListQuery = z.infer<typeof requestListQuery>;

export const requestListResponse = paginated(requestSchema);
export type RequestListResponse = z.infer<typeof requestListResponse>;
