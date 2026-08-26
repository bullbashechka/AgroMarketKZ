import { completeUploadInput, createUploadUrlInput, uploadUrlResponse } from "@agromarket/contracts";
import { Hono } from "hono";
import { getDatabase, getEnv, type HonoEnv } from "../../env";
import { runAdminMutation } from "../../lib/adminAuditRequest";
import { assertUploadedImageSignature, buildCardImagePath, createSignedUploadUrl } from "../../lib/storage";
import { UPLOAD_CLAIM_TTL_SECONDS, createUploadClaim, markUploadClaimValidated } from "../../repos/uploadClaims";

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
  await runAdminMutation(c, 200, (audit) => createUploadClaim(env, {
    storagePath,
    issuerUserId: c.get("auth").userId,
    contentType,
  }, getDatabase(c), audit));
  const { uploadUrl, token } = await createSignedUploadUrl(env, storagePath);
  return c.json(uploadUrlResponse.parse({ storagePath, uploadUrl, token, expiresInSeconds: UPLOAD_CLAIM_TTL_SECONDS }));
});

/** The browser must confirm the written object before it can be attached to a card. */
adminUploadsRoutes.post("/complete", async (c) => {
  const env = getEnv(c);
  const input = completeUploadInput.parse(await c.req.json());
  await assertUploadedImageSignature(env, input.storagePath, input.contentType);
  await runAdminMutation(c, 204, (audit) => markUploadClaimValidated(env, {
    storagePath: input.storagePath,
    issuerUserId: c.get("auth").userId,
    contentType: input.contentType,
  }, getDatabase(c), audit));
  return c.body(null, 204);
});
