import { createUploadUrlInput, uploadUrlResponse } from "@agromarket/contracts";
import { Hono } from "hono";
import { getEnv, type HonoEnv } from "../../env";
import { buildCardImagePath, createSignedUploadUrl } from "../../lib/storage";

export const adminUploadsRoutes = new Hono<HonoEnv>();

/**
 * Signed URL для прямой загрузки фото в Supabase Storage. Клиент грузит файл сам;
 * `storagePath` передаётся в `cardImageInput.storagePath` при создании/редактировании
 * карточки. В E2E окружении путь дополнительно ограничен префиксом текущего run,
 * чтобы незавершённые загрузки можно было удалить без поиска по production namespace.
 */
adminUploadsRoutes.post("/", async (c) => {
  const env = getEnv(c);
  const { contentType } = createUploadUrlInput.parse(await c.req.json());
  const storagePath = buildCardImagePath(contentType, crypto.randomUUID(), env.E2E_RUN_ID);
  const { uploadUrl, token } = await createSignedUploadUrl(env, storagePath);
  return c.json(uploadUrlResponse.parse({ storagePath, uploadUrl, token }));
});
