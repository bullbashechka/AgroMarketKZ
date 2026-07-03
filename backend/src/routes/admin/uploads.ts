import { createUploadUrlInput, uploadUrlResponse } from "@agromarket/contracts";
import { Hono } from "hono";
import { getEnv, type HonoEnv } from "../../env";
import { buildCardImagePath, createSignedUploadUrl } from "../../lib/storage";

export const adminUploadsRoutes = new Hono<HonoEnv>();

/**
 * Signed URL для прямой загрузки фото в Supabase Storage. Клиент грузит файл сам;
 * `storagePath` передаётся в `cardImageInput.storagePath` при создании/редактировании
 * карточки. Загрузки, так и не привязанные к карточке, — принятый MVP-долг.
 */
adminUploadsRoutes.post("/", async (c) => {
  const env = getEnv(c);
  const { contentType } = createUploadUrlInput.parse(await c.req.json());
  const storagePath = buildCardImagePath(contentType);
  const { uploadUrl, token } = await createSignedUploadUrl(env, storagePath);
  return c.json(uploadUrlResponse.parse({ storagePath, uploadUrl, token }));
});
