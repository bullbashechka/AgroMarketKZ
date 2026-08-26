import type { Database } from "../db";
import type { AppEnv } from "../env";
import { deleteStorageObjectsStrict, listStorageObjects } from "../lib/storage";

type E2ECleanupEnv = Pick<
  AppEnv,
  | "DATABASE_URL"
  | "HYPERDRIVE"
  | "SUPABASE_URL"
  | "SUPABASE_STORAGE_BUCKET"
  | "SUPABASE_SERVICE_ROLE_KEY"
  | "E2E_RUN_ID"
>;

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

async function listE2eRunObjects(env: E2ECleanupEnv, prefix: string): Promise<string[]> {
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

/** Удаляет только данные текущего E2E-прогона; без E2E_RUN_ID операция невозможна. */
export async function cleanupE2eRun(env: E2ECleanupEnv, db: Database): Promise<void> {
  if (!env.E2E_RUN_ID) throw new Error("E2E cleanup is unavailable without E2E_RUN_ID");
  const prefix = e2eLikePrefix(env.E2E_RUN_ID);
  const storagePrefix = e2eStoragePrefix(env.E2E_RUN_ID);
  const sql = db.sql;

  const runStoragePaths = await listE2eRunObjects(env, storagePrefix);
  const storageResult = await deleteStorageObjectsStrict(env, runStoragePaths, {
    reconcileMissing: true,
  });
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
      delete from app_private.admin_audit_outbox outbox
      using users
      where outbox.actor_user_id = users.id
        and (
          users.contact_name like ${prefix} escape '\\'
          or users.telegram_first_name like ${prefix} escape '\\'
          or users.telegram_last_name like ${prefix} escape '\\'
        )
    `;
    await tx`
      delete from app_private.admin_audit_events audit
      using users
      where audit.actor_user_id = users.id
        and (
          users.contact_name like ${prefix} escape '\\'
          or users.telegram_first_name like ${prefix} escape '\\'
          or users.telegram_last_name like ${prefix} escape '\\'
        )
    `;
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
