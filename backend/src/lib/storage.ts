import { CARD_IMAGE_PATH_PATTERN as CONTRACT_CARD_IMAGE_PATH_PATTERN, type UploadContentType } from "@agromarket/contracts";
import type { AppEnv } from "../env";
import { HttpError } from "./errors";
import { metricNow, writeMetric } from "./metrics";

type StorageAdminEnv = Pick<
  AppEnv,
  "SUPABASE_URL" | "SUPABASE_STORAGE_BUCKET" | "SUPABASE_SERVICE_ROLE_KEY" | "REQUEST_METRICS"
>;

async function fetchStorage(
  env: StorageAdminEnv,
  operation: string,
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const startedAt = metricNow();
  try {
    const response = await fetch(input, init);
    writeMetric(env, {
      kind: "storage",
      operation,
      outcome: response.ok ? "ok" : "error",
      durationMs: metricNow() - startedAt,
    });
    return response;
  } catch (error) {
    writeMetric(env, { kind: "storage", operation, outcome: "error", durationMs: metricNow() - startedAt });
    throw error;
  }
}

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

const SAFE_E2E_RUN_ID = /^[A-Za-z0-9-]{1,32}$/;

/** Путь к новому фото карточки в бакете (загрузка предшествует созданию карточки). */
export function buildCardImagePath(
  contentType: UploadContentType,
  id = crypto.randomUUID(),
  e2eRunId?: string,
): string {
  if (e2eRunId !== undefined) {
    if (!SAFE_E2E_RUN_ID.test(e2eRunId)) {
      throw new Error("E2E_RUN_ID must contain only 1-32 ASCII letters, digits, or hyphens");
    }
    return `e2e/${e2eRunId}/${id}.${extFromContentType(contentType)}`;
  }
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
  const res = await fetchStorage(env, "create_signed_upload", `${base}/storage/v1/object/upload/sign/${env.SUPABASE_STORAGE_BUCKET}/${path}`, {
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

/** Reads only the signature bytes needed to reject a renamed/non-image upload. */
export async function assertUploadedImageSignature(
  env: StorageAdminEnv,
  storagePath: string,
  expectedContentType: UploadContentType,
): Promise<void> {
  const response = await downloadStorageObject(env, storagePath);
  if (!response.ok || !response.body) {
    throw new HttpError(400, "Загруженный файл не найден. Повторите загрузку.");
  }
  const reader = response.body.getReader();
  const bytes: number[] = [];
  try {
    while (bytes.length < 12) {
      const { done, value } = await reader.read();
      if (done) break;
      for (const byte of value) {
        bytes.push(byte);
        if (bytes.length === 12) break;
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const isPng = bytes.slice(0, 8).join(",") === "137,80,78,71,13,10,26,10";
  const isWebp = bytes.slice(0, 4).join("") === "82827370"
    && bytes.slice(8, 12).join("") === "87696680";
  const valid = expectedContentType === "image/jpeg" ? isJpeg
    : expectedContentType === "image/png" ? isPng
      : isWebp;
  if (!valid) throw new HttpError(400, "Тип загруженного файла не соответствует изображению");
}

/**
 * Удаляет объекты из Storage по `storage_path` (например, при удалении/замене фото карточки).
 * Best-effort: сбой не бросает исключение, только логируется — карточка в БД уже изменена.
 */
export async function deleteStorageObjects(env: AppEnv, storagePaths: string[]): Promise<void> {
  if (storagePaths.length === 0) return;
  const base = env.SUPABASE_URL.replace(/\/+$/, "");
  try {
    const res = await fetchStorage(env, "delete_objects", `${base}/storage/v1/object/${env.SUPABASE_STORAGE_BUCKET}`, {
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

/** Путь к фото карточки: `cards/<uuid>.(jpg|png|webp)`, без вложенных папок. */
export const CARD_IMAGE_PATH_PATTERN = CONTRACT_CARD_IMAGE_PATH_PATTERN;

const CARD_IMAGES_PREFIX = "cards/";

interface SupabaseStorageListItem {
  name: string;
  created_at: string | null;
}

export interface StorageObjectSummary {
  storagePath: string;
  createdAt: Date;
}

function storageObjectUrl(env: StorageAdminEnv, storagePath: string): string {
  const base = env.SUPABASE_URL.replace(/\/+$/, "");
  const path = storagePath
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
  return `${base}/storage/v1/object/${encodeURIComponent(env.SUPABASE_STORAGE_BUCKET)}/${path}`;
}

/** Скачивает один объект для server-side backup; URL не публикуется клиенту. */
export async function downloadStorageObject(
  env: StorageAdminEnv,
  storagePath: string,
): Promise<Response> {
  return fetchStorage(env, "download_object", storageObjectUrl(env, storagePath), {
    headers: {
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    },
  });
}

/** Постранично перечисляет объекты Storage под произвольным безопасным префиксом. */
export async function listStorageObjects(
  env: StorageAdminEnv,
  prefix: string,
  options: { limit: number; offset: number },
): Promise<StorageObjectSummary[]> {
  const base = env.SUPABASE_URL.replace(/\/+$/, "");
  const normalizedPrefix = prefix.replace(/^\/+/, "");
  const res = await fetchStorage(env, "list_objects", `${base}/storage/v1/object/list/${encodeURIComponent(env.SUPABASE_STORAGE_BUCKET)}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      prefix: normalizedPrefix,
      limit: options.limit,
      offset: options.offset,
      sortBy: { column: "created_at", order: "asc" }
    })
  });
  if (!res.ok) {
    throw new HttpError(502, "Не удалось получить список объектов Storage");
  }
  const items = (await res.json()) as SupabaseStorageListItem[];
  return items
    .filter((item) => item.created_at !== null)
    .map((item) => ({
      storagePath: `${normalizedPrefix}${item.name.replace(/^\/+/, "")}`,
      createdAt: new Date(item.created_at as string)
    }));
}

/**
 * Постранично перечисляет объекты бакета под префиксом `cards/` (для storageCleanup).
 * Supabase возвращает `name` относительно `prefix` — здесь он приводится к полному storage_path.
 * Записи без валидного `created_at` (папки-плейсхолдеры) отбрасываются.
 */
export async function listCardImageObjects(
  env: AppEnv,
  options: { limit: number; offset: number }
): Promise<StorageObjectSummary[]> {
  return listStorageObjects(env, CARD_IMAGES_PREFIX, options);
}

export interface StrictDeleteResult {
  deleted: string[];
  failed: string[];
}

export interface StrictDeleteOptions {
  /**
   * Test-only recovery for a lost DELETE response. A path is marked deleted only
   * after a follow-up HEAD confirms that Storage no longer has the object.
   */
  reconcileMissing?: boolean;
}

async function reconcileMissingStoragePaths(env: StorageAdminEnv, paths: string[]): Promise<string[]> {
  const missing: string[] = [];
  for (const path of paths) {
    try {
      const response = await fetchStorage(env, "head_object", storageObjectUrl(env, path), {
        method: "HEAD",
        headers: {
          Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
          apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        },
      });
      if (response.status === 404) missing.push(path);
    } catch {
      // An unavailable HEAD cannot prove absence, so the path remains failed.
    }
  }
  return missing;
}

/**
 * Строгое удаление объектов Storage для storageCleanup: в отличие от `deleteStorageObjects`
 * никогда не скрывает частичный сбой — возвращает точный список удалённых/неудалённых путей,
 * чтобы вызывающий код мог корректно логировать и не считал неудачное удаление успешным.
 */
export async function deleteStorageObjectsStrict(
  env: StorageAdminEnv,
  storagePaths: string[],
  options: StrictDeleteOptions = {},
): Promise<StrictDeleteResult> {
  if (storagePaths.length === 0) return { deleted: [], failed: [] };
  const base = env.SUPABASE_URL.replace(/\/+$/, "");
  const uniquePaths = [...new Set(storagePaths)];
  try {
    const res = await fetchStorage(env, "delete_objects_strict", `${base}/storage/v1/object/${env.SUPABASE_STORAGE_BUCKET}`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ prefixes: uniquePaths })
    });
    if (!res.ok) {
      console.error("deleteStorageObjectsStrict: Supabase Storage вернул ошибку", res.status);
      const reconciled = options.reconcileMissing
        ? await reconcileMissingStoragePaths(env, uniquePaths)
        : [];
      const reconciledSet = new Set(reconciled);
      return {
        deleted: reconciled,
        failed: uniquePaths.filter((path) => !reconciledSet.has(path)),
      };
    }
    const removed = (await res.json()) as { name: string }[];
    const removedPaths = new Set(removed.map((item) => item.name));
    const deleted = uniquePaths.filter((path) => removedPaths.has(path));
    const unresolved = uniquePaths.filter((path) => !removedPaths.has(path));
    const reconciled = options.reconcileMissing
      ? await reconcileMissingStoragePaths(env, unresolved)
      : [];
    const deletedSet = new Set([...deleted, ...reconciled]);
    return {
      deleted: uniquePaths.filter((path) => deletedSet.has(path)),
      failed: uniquePaths.filter((path) => !deletedSet.has(path))
    };
  } catch (err) {
    console.error("deleteStorageObjectsStrict: не удалось удалить объекты", err);
    const reconciled = options.reconcileMissing
      ? await reconcileMissingStoragePaths(env, uniquePaths)
      : [];
    const reconciledSet = new Set(reconciled);
    return {
      deleted: reconciled,
      failed: uniquePaths.filter((path) => !reconciledSet.has(path)),
    };
  }
}
