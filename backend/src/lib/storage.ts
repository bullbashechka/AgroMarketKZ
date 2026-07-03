import type { UploadContentType } from "@agromarket/contracts";
import type { AppEnv } from "../env";
import { HttpError } from "./errors";

/**
 * Публичный URL изображения в Supabase Storage (бакет публичный, см.
 * `database/supabase/storage.sql`). В БД хранится только `storage_path`.
 */
export function publicImageUrl(env: AppEnv, storagePath: string): string {
  const base = env.SUPABASE_URL.replace(/\/+$/, "");
  const path = storagePath.replace(/^\/+/, "");
  return `${base}/storage/v1/object/public/${env.SUPABASE_STORAGE_BUCKET}/${path}`;
}

const EXTENSION_BY_CONTENT_TYPE: Record<UploadContentType, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp"
};

/** Расширение файла по MIME-типу загружаемого фото. */
export function extFromContentType(contentType: UploadContentType): string {
  return EXTENSION_BY_CONTENT_TYPE[contentType];
}

/** Путь к новому фото карточки в бакете (загрузка предшествует созданию карточки). */
export function buildCardImagePath(contentType: UploadContentType, id = crypto.randomUUID()): string {
  return `cards/${id}.${extFromContentType(contentType)}`;
}

interface SupabaseSignedUploadResponse {
  url: string;
}

/**
 * Разбирает ответ Supabase Storage `{ url: "/object/upload/sign/{bucket}/{path}?token=..." }`
 * в абсолютный URL для загрузки и извлечённый token (для `supabase-js` `uploadToSignedUrl`).
 */
export function signedUploadUrlFromResponse(
  env: AppEnv,
  response: SupabaseSignedUploadResponse
): { uploadUrl: string; token: string } {
  const base = env.SUPABASE_URL.replace(/\/+$/, "");
  const relative = response.url.startsWith("/") ? response.url : `/${response.url}`;
  const uploadUrl = `${base}/storage/v1${relative}`;
  const token = new URL(uploadUrl).searchParams.get("token");
  if (!token) {
    throw new HttpError(502, "Не удалось подготовить загрузку изображения");
  }
  return { uploadUrl, token };
}

/** Запрашивает у Supabase Storage signed URL для прямой загрузки фото клиентом. */
export async function createSignedUploadUrl(
  env: AppEnv,
  storagePath: string
): Promise<{ uploadUrl: string; token: string }> {
  const base = env.SUPABASE_URL.replace(/\/+$/, "");
  const path = storagePath.replace(/^\/+/, "");
  const res = await fetch(`${base}/storage/v1/object/upload/sign/${env.SUPABASE_STORAGE_BUCKET}/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({})
  });
  if (!res.ok) {
    throw new HttpError(502, "Не удалось подготовить загрузку изображения");
  }
  const data = (await res.json()) as SupabaseSignedUploadResponse;
  return signedUploadUrlFromResponse(env, data);
}

/**
 * Удаляет объекты из Storage по `storage_path` (например, при удалении/замене фото карточки).
 * Best-effort: сбой не бросает исключение, только логируется — карточка в БД уже изменена.
 */
export async function deleteStorageObjects(env: AppEnv, storagePaths: string[]): Promise<void> {
  if (storagePaths.length === 0) return;
  const base = env.SUPABASE_URL.replace(/\/+$/, "");
  try {
    const res = await fetch(`${base}/storage/v1/object/${env.SUPABASE_STORAGE_BUCKET}`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ prefixes: storagePaths })
    });
    if (!res.ok) {
      console.error("deleteStorageObjects: Supabase Storage вернул ошибку", res.status, await res.text());
    }
  } catch (err) {
    console.error("deleteStorageObjects: не удалось удалить объекты", err);
  }
}
