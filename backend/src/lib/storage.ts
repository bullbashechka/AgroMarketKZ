import type { AppEnv } from "../env";

/**
 * Публичный URL изображения в Supabase Storage (бакет публичный, см.
 * `database/supabase/storage.sql`). В БД хранится только `storage_path`.
 */
export function publicImageUrl(env: AppEnv, storagePath: string): string {
  const base = env.SUPABASE_URL.replace(/\/+$/, "");
  const path = storagePath.replace(/^\/+/, "");
  return `${base}/storage/v1/object/public/${env.SUPABASE_STORAGE_BUCKET}/${path}`;
}
