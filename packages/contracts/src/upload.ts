import { z } from "zod";

/** Допустимые типы содержимого для фото карточек. */
export const uploadContentTypeSchema = z.enum(["image/jpeg", "image/png", "image/webp"]);
export type UploadContentType = z.infer<typeof uploadContentTypeSchema>;

/** Запрос на signed URL для загрузки одного фото (админ). */
export const createUploadUrlInput = z.object({
  contentType: uploadContentTypeSchema
});

export type CreateUploadUrlInput = z.infer<typeof createUploadUrlInput>;

/**
 * Ответ с данными для прямой загрузки в Supabase Storage.
 * `storagePath` — сохраняется в `cardImageInput.storagePath` при создании/редактировании карточки.
 */
export const uploadUrlResponse = z.object({
  storagePath: z.string(),
  uploadUrl: z.string(),
  token: z.string()
});

export type UploadUrlResponse = z.infer<typeof uploadUrlResponse>;
