import { getDb } from "../db";
import type { AppEnv } from "../env";

/**
 * Из переданных кандидатов возвращает те, что всё ещё referenced в `card_images.storage_path`.
 * Используется storageCleanup для batch-фильтрации и повторной проверки перед удалением.
 */
export async function findReferencedStoragePaths(
  env: AppEnv,
  candidatePaths: string[]
): Promise<Set<string>> {
  if (candidatePaths.length === 0) return new Set();
  const sql = getDb(env);
  const rows = await sql<{ storage_path: string }[]>`
    select storage_path from card_images where storage_path = any(${candidatePaths})
  `;
  return new Set(rows.map((row) => row.storage_path));
}
