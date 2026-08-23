import { z } from "zod";
import { PRODUCT_LOCATION_DETAIL_MAX, REQUEST_COMMENT_MAX } from "./constants";
import {
  catalogTypeSchema,
  priceTypeSchema,
  requestSourceSchema,
  requestStatusSchema
} from "./enums";
import { paginated, paginationQuerySchema } from "./pagination";
import { contactNameSchema, optionalText } from "./primitives";
import { phoneSchema } from "./phone";
import {
  productLocationSchema,
  productOwnershipFormSchema,
  territoryCodeSchema,
  territorySchema
} from "./territory";

const territoryCodesSchema = z.array(territoryCodeSchema).max(20).refine(
  (codes) => new Set(codes).size === codes.length,
  "Регионы не должны повторяться"
);

export const listingSubmissionInputSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("product"),
    categoryId: z.uuid({ error: "Выберите категорию" }),
    territoryCode: territoryCodeSchema,
    ownershipForm: productOwnershipFormSchema,
    productLocation: productLocationSchema,
    productLocationDetail: z.string()
      .trim()
      .max(PRODUCT_LOCATION_DETAIL_MAX)
      .optional()
      .transform((value) => value || undefined)
  }),
  z.object({
    type: z.literal("service"),
    categoryId: z.uuid({ error: "Выберите категорию" }),
    allKazakhstan: z.boolean(),
    territoryCodes: territoryCodesSchema
  })
]).superRefine((input, ctx) => {
  if (input.type === "service") {
    if (input.allKazakhstan && input.territoryCodes.length > 0) {
      ctx.addIssue({ code: "custom", path: ["territoryCodes"], message: "Выберите регионы или весь Казахстан" });
    }
    if (!input.allKazakhstan && input.territoryCodes.length === 0) {
      ctx.addIssue({ code: "custom", path: ["territoryCodes"], message: "Выберите хотя бы один регион" });
    }
  }
});

export type ListingSubmissionInput = z.infer<typeof listingSubmissionInputSchema>;

export const listingSubmissionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("product"),
    categoryId: z.uuid().nullable(),
    categoryName: z.string(),
    territory: territorySchema,
    ownershipForm: productOwnershipFormSchema,
    productLocation: productLocationSchema,
    productLocationDetail: z.string().nullable()
  }),
  z.object({
    type: z.literal("service"),
    categoryId: z.uuid().nullable(),
    categoryName: z.string(),
    allKazakhstan: z.boolean(),
    territories: z.array(territorySchema)
  })
]);

export type ListingSubmission = z.infer<typeof listingSubmissionSchema>;

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
  cardPriceUnitSnapshot: z.string().nullable(),
  cardPriceReasonSnapshot: z.string().nullable(),
  clientRequestId: z.uuid().nullable(),
  contactName: z.string(),
  contactPhone: z.string(),
  contactPhoneVerified: z.boolean(),
  comment: z.string().nullable(),
  listingSubmission: listingSubmissionSchema.nullable(),
  status: requestStatusSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime()
});

export type Request = z.infer<typeof requestSchema>;

// Контактные поля общие для всех источников. Имя и телефон предзаполняются из профиля,
// но всё равно валидируются на отправке.
const contactFields = {
  clientRequestId: z.uuid({ error: "Некорректный идентификатор отправки" }),
  contactName: contactNameSchema,
  contactPhone: phoneSchema,
  contactResponse: z.string().min(1).optional(),
  comment: optionalText(REQUEST_COMMENT_MAX)
};

const createRequestInputBase = z.discriminatedUnion("source", [
  z.object({
    source: z.literal("card"),
    cardId: z.uuid({ error: "Не указана карточка" }),
    ...contactFields
  }),
  z.object({
    source: z.literal("tab"),
    tabType: catalogTypeSchema,
    listingSubmission: listingSubmissionInputSchema.optional(),
    ...contactFields
  }),
  z.object({
    source: z.literal("profile"),
    ...contactFields
  })
]);

/** Создание обычной либо структурированной tab-заявки. */
export const createRequestInput = createRequestInputBase.superRefine((input, ctx) => {
  if (input.source === "tab" && input.listingSubmission?.type !== undefined && input.listingSubmission.type !== input.tabType) {
    ctx.addIssue({ code: "custom", path: ["listingSubmission", "type"], message: "Тип заявки не совпадает с вкладкой" });
  }
});

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
