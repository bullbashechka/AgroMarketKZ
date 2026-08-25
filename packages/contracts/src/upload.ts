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
  token: z.string(),
  expiresInSeconds: z.number().int().positive(),
});

export type UploadUrlResponse = z.infer<typeof uploadUrlResponse>;

/** Подтверждает серверу, что байты по выданному пути действительно являются заявленным изображением. */
export const completeUploadInput = z.object({
  storagePath: z.string(),
  contentType: uploadContentTypeSchema,
});

export type CompleteUploadInput = z.infer<typeof completeUploadInput>;
