import { z } from "zod";
import {
  ALT_TEXT_MAX,
  CARD_TITLE_MAX,
  DESCRIPTION_MAX,
  MAX_IMAGES,
  MAX_SPECS,
  MIN_IMAGES,
  PRICE_MAX,
  PRICE_MIN,
  SPEC_KEY_MAX,
  SPEC_VALUE_MAX,
  STORAGE_PATH_MAX
} from "./constants";
import { catalogTypeSchema, priceTypeSchema } from "./enums";
import { requiredText } from "./primitives";

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
  sortOrder: z.number().int(),
  archivedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  images: z.array(cardImageSchema),
  specs: z.array(cardSpecSchema)
});

export type CardDetail = z.infer<typeof cardDetailSchema>;

// --- Ввод при создании/редактировании (админ) ---

const cardBaseInput = z.object({
  type: catalogTypeSchema,
  categoryId: z.uuid({ error: "Выберите категорию" }),
  title: requiredText(CARD_TITLE_MAX, "Укажите название"),
  description: z.string().trim().max(DESCRIPTION_MAX).default(""),
  sortOrder: z.number().int().min(0).default(0),
  images: z
    .array(cardImageInput)
    .min(MIN_IMAGES, { error: "Добавьте хотя бы одно фото" })
    .max(MAX_IMAGES, { error: `Не более ${MAX_IMAGES} фото` }),
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

// Цена — условная логика, зеркалит CHECK cards_valid_price из БД:
// fixed → priceAmount задан и > 0; on_request → priceAmount отсутствует.
export const createCardInput = z.discriminatedUnion("priceType", [
  cardBaseInput.extend({
    priceType: z.literal("fixed"),
    priceAmount: z
      .number({ error: "Укажите цену" })
      .int({ error: "Цена — целое число тенге" })
      .min(PRICE_MIN, { error: "Цена должна быть больше нуля" })
      .max(PRICE_MAX, { error: "Слишком большая цена — проверьте число" })
  }),
  cardBaseInput.extend({
    priceType: z.literal("on_request"),
    priceAmount: z.null().optional()
  })
]);

export type CreateCardInput = z.infer<typeof createCardInput>;

/** Редактирование карточки — полная замена полей (админ задаёт все поля). */
export const updateCardInput = createCardInput;
export type UpdateCardInput = z.infer<typeof updateCardInput>;
