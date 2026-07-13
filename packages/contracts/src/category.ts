import { z } from "zod";
import { CATEGORY_NAME_MAX, MAX_SPECS, SPEC_KEY_MAX } from "./constants";
import { catalogTypeSchema } from "./enums";
import { requiredText } from "./primitives";

/** Категория (ответ API). */
export const categorySchema = z.object({
  id: z.uuid(),
  type: catalogTypeSchema,
  name: z.string(),
  sortOrder: z.number().int(),
  isActive: z.boolean(),
  requiredSpecs: z.array(z.string()),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime()
});

export type Category = z.infer<typeof categorySchema>;

/** Категория в публичном списке вкладки — с числом опубликованных карточек. */
export const categoryListItemSchema = categorySchema.extend({
  cardCount: z.number().int().min(0)
});

export type CategoryListItem = z.infer<typeof categoryListItemSchema>;

/** Категория в админ-списке — со счётчиками карточек (все / только опубликованные). */
export const adminCategorySchema = categorySchema.extend({
  cardCount: z.number().int().min(0),
  activeCardCount: z.number().int().min(0)
});

export type AdminCategory = z.infer<typeof adminCategorySchema>;

export const adminCategoryListResponse = z.array(adminCategorySchema);

/** Создание категории (админ). */
export const createCategoryInput = z.object({
  type: catalogTypeSchema,
  name: requiredText(CATEGORY_NAME_MAX, "Укажите название категории"),
  sortOrder: z.number().int().min(0).default(0),
  requiredSpecs: z.array(requiredText(SPEC_KEY_MAX, "Укажите название характеристики")).max(MAX_SPECS).default([]),
});

export type CreateCategoryInput = z.infer<typeof createCategoryInput>;

/** Переименование/перемещение категории (админ). Тип категории не меняется. */
export const updateCategoryInput = z.object({
  name: requiredText(CATEGORY_NAME_MAX, "Укажите название категории").optional(),
  sortOrder: z.number().int().min(0).optional(),
  requiredSpecs: z.array(requiredText(SPEC_KEY_MAX, "Укажите название характеристики")).max(MAX_SPECS).optional(),
}).superRefine((input, ctx) => {
  if (!input.requiredSpecs) return;
  const normalized = input.requiredSpecs.map((item) => item.trim().toLocaleLowerCase("ru"));
  if (new Set(normalized).size !== normalized.length) {
    ctx.addIssue({ code: "custom", path: ["requiredSpecs"], message: "Обязательные характеристики не должны повторяться" });
  }
});

export type UpdateCategoryInput = z.infer<typeof updateCategoryInput>;
