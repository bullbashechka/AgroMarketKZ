import { z } from "zod";
import {
  ALT_TEXT_MAX,
  AVAILABILITY_MAX,
  CARD_TITLE_MAX,
  DESCRIPTION_MAX,
  MAX_IMAGES,
  MAX_SPECS,
  MIN_IMAGES,
  LOCATION_MAX,
  PRICE_MAX,
  PRICE_MIN,
  PRICE_REASON_MAX,
  PRICE_UNIT_MAX,
  SPEC_KEY_MAX,
  SPEC_VALUE_MAX,
  STORAGE_PATH_MAX
} from "./constants";
import { catalogTypeSchema, priceTypeSchema, publicationStatusSchema } from "./enums";
import { optionalText, requiredText } from "./primitives";

// --- Изображения ---

/** Изображение карточки (ответ API). */
export const cardImageSchema = z.object({
  id: z.uuid(),
  storagePath: z.string(),
  url: z.string(), // публичный URL, собирается backend из storagePath
  altText: z.string().nullable(),
  sortOrder: z.number().int()
});

export type CardImage = z.infer<typeof cardImageSchema>;

/** Изображение при создании/редактировании карточки (админ). */
export const cardImageInput = z.object({
  storagePath: requiredText(STORAGE_PATH_MAX, "Путь к изображению обязателен"),
  altText: z.string().trim().max(ALT_TEXT_MAX).optional(),
  sortOrder: z.number().int().min(0).default(0)
});

// --- Характеристики ---

/** Характеристика «ключ — значение» (ответ API). */
export const cardSpecSchema = z.object({
  id: z.uuid(),
  key: z.string(),
  value: z.string(),
  sortOrder: z.number().int()
});

export type CardSpec = z.infer<typeof cardSpecSchema>;

/** Характеристика при создании/редактировании карточки (админ). */
export const cardSpecInput = z.object({
  key: requiredText(SPEC_KEY_MAX, "Укажите название характеристики"),
  value: requiredText(SPEC_VALUE_MAX, "Укажите значение характеристики"),
  sortOrder: z.number().int().min(0).default(0)
});

// --- Карточка ---

/** Карточка в списке (превью маркетплейса). */
export const cardListItemSchema = z.object({
  id: z.uuid(),
  type: catalogTypeSchema,
  categoryId: z.uuid(),
  title: z.string(),
  priceType: priceTypeSchema,
  priceAmount: z.number().int().nullable(),
  priceUnit: z.string().nullable(),
  imageUrl: z.string().nullable(), // первое фото галереи
  shortSpec: z.string().nullable() // краткая характеристика для превью
});

export type CardListItem = z.infer<typeof cardListItemSchema>;

/** Полная карточка товара/услуги (ответ API). */
export const cardDetailSchema = z.object({
  id: z.uuid(),
  type: catalogTypeSchema,
  categoryId: z.uuid(),
  title: z.string(),
  description: z.string(),
  priceType: priceTypeSchema,
  priceAmount: z.number().int().nullable(),
  priceUnit: z.string().nullable(),
  priceReason: z.string().nullable(),
  location: z.string().nullable(),
  availability: z.string().nullable(),
  sortOrder: z.number().int(),
  publishedAt: z.iso.datetime().nullable(),
  archivedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  images: z.array(cardImageSchema),
  specs: z.array(cardSpecSchema)
});

export type CardDetail = z.infer<typeof cardDetailSchema>;

// --- Ввод при создании/редактировании (админ) ---

const optionalNullableText = (max: number) =>
  z.preprocess((value) => value === null ? undefined : value, optionalText(max));

const cardBaseInput = z.object({
  type: catalogTypeSchema,
  categoryId: z.uuid({ error: "Выберите категорию" }),
  title: requiredText(CARD_TITLE_MAX, "Укажите название"),
  description: z.string().trim().max(DESCRIPTION_MAX).default(""),
  priceType: priceTypeSchema.default("fixed"),
  priceAmount: z
    .number({ error: "Укажите цену числом" })
    .int({ error: "Цена — целое число тенге" })
    .min(PRICE_MIN, { error: "Цена должна быть больше нуля" })
    .max(PRICE_MAX, { error: "Слишком большая цена — проверьте число" })
    .nullable()
    .optional(),
  priceUnit: optionalNullableText(PRICE_UNIT_MAX),
  priceReason: optionalNullableText(PRICE_REASON_MAX),
  location: optionalNullableText(LOCATION_MAX),
  availability: optionalNullableText(AVAILABILITY_MAX),
  sortOrder: z.number().int().min(0).default(0),
  images: z
    .array(cardImageInput)
    .max(MAX_IMAGES, { error: `Не более ${MAX_IMAGES} фото` })
    .default([]),
  specs: z
    .array(cardSpecInput)
    .max(MAX_SPECS, { error: `Не более ${MAX_SPECS} характеристик` })
    .refine(
      (specs) => {
        const keys = specs.map((s) => s.key.trim().toLowerCase());
        return new Set(keys).size === keys.length;
      },
      { error: "Характеристики не должны повторяться по названию" }
    )
    .default([])
});

/** Серверный черновик: обязательны только тип, категория и название. */
export const createCardInput = cardBaseInput.superRefine((input, ctx) => {
  if (input.priceType === "on_request" && input.priceAmount != null) {
    ctx.addIssue({ code: "custom", path: ["priceAmount"], message: "Для цены по запросу сумма не указывается" });
  }
  if (input.priceType === "fixed" && input.priceReason) {
    ctx.addIssue({ code: "custom", path: ["priceReason"], message: "Для фиксированной цены пояснение не требуется" });
  }
});

export type CreateCardInput = z.infer<typeof createCardInput>;

/** Полная клиентская проверка перед публикацией; требования категории проверяет backend. */
export const publishCardInput = createCardInput.superRefine((input, ctx) => {
  if (!input.description.trim()) {
    ctx.addIssue({ code: "custom", path: ["description"], message: "Добавьте описание" });
  }
  if (input.images.length < MIN_IMAGES) {
    ctx.addIssue({ code: "custom", path: ["images"], message: "Добавьте хотя бы одно фото" });
  }
  if (!input.location) {
    ctx.addIssue({ code: "custom", path: ["location"], message: "Укажите регион или территорию" });
  }
  if (!input.availability) {
    ctx.addIssue({ code: "custom", path: ["availability"], message: "Укажите наличие или срок исполнения" });
  }
  if (!input.priceUnit) {
    ctx.addIssue({ code: "custom", path: ["priceUnit"], message: "Укажите единицу цены" });
  }
  if (input.priceType !== "on_request" && input.priceAmount == null) {
    ctx.addIssue({ code: "custom", path: ["priceAmount"], message: "Укажите цену" });
  }
  if (input.priceType === "on_request" && !input.priceReason) {
    ctx.addIssue({ code: "custom", path: ["priceReason"], message: "Объясните, от чего зависит цена" });
  }
});

export type PublishCardInput = z.infer<typeof publishCardInput>;

/** Редактирование карточки — полная замена полей (админ задаёт все поля). */
export const updateCardInput = createCardInput;
export type UpdateCardInput = z.infer<typeof updateCardInput>;

export const adminCardDetailSchema = cardDetailSchema.extend({
  publicationStatus: publicationStatusSchema,
  needsReview: z.boolean(),
  reviewIssues: z.array(z.string()),
});

export type AdminCardDetail = z.infer<typeof adminCardDetailSchema>;
