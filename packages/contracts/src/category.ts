import { z } from "zod";
import { CATEGORY_NAME_MAX } from "./constants";
import { catalogTypeSchema } from "./enums";
import { requiredText } from "./primitives";

/** Категория (ответ API). */
export const categorySchema = z.object({
  id: z.uuid(),
  type: catalogTypeSchema,
  name: z.string(),
  sortOrder: z.number().int(),
  isActive: z.boolean(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime()
});

export type Category = z.infer<typeof categorySchema>;

/** Создание категории (админ). */
export const createCategoryInput = z.object({
  type: catalogTypeSchema,
  name: requiredText(CATEGORY_NAME_MAX, "Укажите название категории"),
  sortOrder: z.number().int().min(0).default(0)
});

export type CreateCategoryInput = z.infer<typeof createCategoryInput>;

/** Переименование/перемещение категории (админ). Тип категории не меняется. */
export const updateCategoryInput = z.object({
  name: requiredText(CATEGORY_NAME_MAX, "Укажите название категории").optional(),
  sortOrder: z.number().int().min(0).optional()
});

export type UpdateCategoryInput = z.infer<typeof updateCategoryInput>;
