import { z } from "zod";
import { SEARCH_MAX } from "./constants";
import { cardListItemSchema } from "./card";
import { catalogTypeSchema } from "./enums";
import { publicationStatusSchema } from "./enums";
import { paginated, paginationQuerySchema } from "./pagination";
import { profileSchema } from "./profile";

/** Список карточек (админ) — как публичный каталог, но без фильтра по видимости. */
export const adminCardListQuery = paginationQuerySchema.extend({
  type: catalogTypeSchema.optional(),
  categoryId: z.uuid().optional(),
  search: z
    .string()
    .trim()
    .max(SEARCH_MAX)
    .optional()
    .transform((value) => (value && value.length > 0 ? value : undefined)),
  archived: z.enum(["all", "active", "archived"]).default("all")
});

export type AdminCardListQuery = z.infer<typeof adminCardListQuery>;

/** Карточка в админ-списке — превью + служебные поля для управления. */
export const adminCardListItemSchema = cardListItemSchema.extend({
  sortOrder: z.number().int(),
  archivedAt: z.iso.datetime().nullable(),
  publishedAt: z.iso.datetime().nullable(),
  publicationStatus: publicationStatusSchema,
  needsReview: z.boolean(),
  reviewIssues: z.array(z.string()),
  updatedAt: z.iso.datetime()
});

export type AdminCardListItem = z.infer<typeof adminCardListItemSchema>;

export const adminCardListResponse = paginated(adminCardListItemSchema);
export type AdminCardListResponse = z.infer<typeof adminCardListResponse>;

/** Список зарегистрированных пользователей (админ). */
export const adminUserListQuery = paginationQuerySchema;
export type AdminUserListQuery = z.infer<typeof adminUserListQuery>;

export const adminUserListResponse = paginated(profileSchema);
export type AdminUserListResponse = z.infer<typeof adminUserListResponse>;
