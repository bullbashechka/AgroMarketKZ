import { getDb } from "../db";
import type { AppEnv } from "../env";
import { deleteStorageObjectsStrict, listStorageObjects } from "../lib/storage";
import { findReferencedStoragePaths } from "./cardImages";

const E2E_STORAGE_LIST_PAGE_SIZE = 100;
const E2E_STORAGE_PREFIX = "e2e/";

export function e2eLikePrefix(runId: string): string {
  const escaped = runId.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
  return `[e2e:${escaped}]%`;
}

export function e2eStoragePrefix(runId: string): string {
  const escaped = runId.replace(/[^A-Za-z0-9-]/g, "");
  if (!escaped || escaped !== runId || escaped.length > 32) {
    throw new Error("Invalid E2E_RUN_ID for Storage cleanup");
  }
  return `${E2E_STORAGE_PREFIX}${escaped}/`;
}

async function listE2eRunObjects(env: AppEnv, prefix: string): Promise<string[]> {
  const paths: string[] = [];
  let offset = 0;
  while (true) {
    const page = await listStorageObjects(env, prefix, {
      limit: E2E_STORAGE_LIST_PAGE_SIZE,
      offset,
    });
    paths.push(...page.map((object) => object.storagePath));
    if (page.length < E2E_STORAGE_LIST_PAGE_SIZE) break;
    offset += page.length;
  }
  return [...new Set(paths)];
}

async function findExternalImageReferences(
  env: AppEnv,
  storagePaths: string[],
  runPrefix: string,
): Promise<Set<string>> {
  if (storagePaths.length === 0) return new Set();
  const sql = getDb(env);
  const rows = await sql<{ storage_path: string }[]>`
    select distinct ci.storage_path
    from card_images ci
    join cards c on c.id = ci.card_id
    where ci.storage_path = any(${storagePaths}::text[])
      and c.title not like ${runPrefix} escape '\\'
  `;
  return new Set(rows.map((row) => row.storage_path));
}

/** Удаляет только данные текущего E2E-прогона; без E2E_RUN_ID операция невозможна. */
export async function cleanupE2eRun(env: AppEnv): Promise<void> {
  if (!env.E2E_RUN_ID) throw new Error("E2E cleanup is unavailable without E2E_RUN_ID");
  const prefix = e2eLikePrefix(env.E2E_RUN_ID);
  const storagePrefix = e2eStoragePrefix(env.E2E_RUN_ID);
  const sql = getDb(env);

  const imageRows = await sql<{ storage_path: string }[]>`
    select ci.storage_path
    from card_images ci
    join cards c on c.id = ci.card_id
    where c.title like ${prefix} escape '\\'
  `;

  // Помимо ссылок из card_images, ищем объекты текущего run без ссылки. Такая
  // загрузка могла завершиться до сетевого сбоя при создании/сохранении карточки.
  const runStoragePaths = await listE2eRunObjects(env, storagePrefix);
  const referencedRunPaths = await findReferencedStoragePaths(env, runStoragePaths);
  const unboundRunPaths = runStoragePaths.filter((path) => !referencedRunPaths.has(path));

  // Storage удаляем до SQL. Успешные ссылки можно убрать сразу, а неудачные
  // оставляем в card_images, чтобы следующий teardown повторил только их.
  const imagePaths = [...new Set(imageRows.map((row) => row.storage_path))];
  // A malformed/manual E2E fixture could share a path with another card. Never
  // remove that object while the other card still references it.
  const externalReferences = await findExternalImageReferences(env, imagePaths, prefix);
  const deletableImagePaths = imagePaths.filter((path) => !externalReferences.has(path));
  const storageResult = await deleteStorageObjectsStrict(
    env,
    [...new Set([...deletableImagePaths, ...unboundRunPaths])],
    { reconcileMissing: true },
  );
  if (storageResult.deleted.length > 0) {
    await sql`
      delete from card_images ci
      using cards c
      where c.id = ci.card_id
        and c.title like ${prefix} escape '\\'
        and ci.storage_path = any(${storageResult.deleted}::text[])
    `;
  }
  if (storageResult.failed.length > 0) {
    throw new Error(`E2E Storage cleanup failed for ${storageResult.failed.length} object(s)`);
  }

  await sql.begin(async (tx) => {
    await tx`delete from requests where comment like ${prefix} escape '\\'`;
    await tx`
      delete from feedback_messages
      where contact_name like ${prefix} escape '\\'
        or message like ${prefix} escape '\\'
    `;
    await tx`delete from cards where title like ${prefix} escape '\\'`;
    await tx`delete from categories where name like ${prefix} escape '\\'`;
    await tx`
      delete from users
      where (
          contact_name like ${prefix} escape '\\'
          or telegram_first_name like ${prefix} escape '\\'
          or telegram_last_name like ${prefix} escape '\\'
        )
        and not exists (select 1 from requests where requests.user_id = users.id)
        and not exists (select 1 from feedback_messages where feedback_messages.user_id = users.id)
    `;
  });
}
