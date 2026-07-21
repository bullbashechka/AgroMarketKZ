import type { AppEnv } from "../env";
import { findReferencedStoragePaths } from "../repos/cardImages";
import {
  CARD_IMAGE_PATH_PATTERN,
  deleteStorageObjectsStrict,
  listCardImageObjects,
  type StorageObjectSummary
} from "./storage";

/** Не трогать объект, пока он моложе окна — черновик карточки мог не быть отправлен. */
export const CLEANUP_GRACE_PERIOD_DAYS = 7;
/** Размер страницы при постраничном listing Storage. */
export const CLEANUP_LIST_PAGE_SIZE = 100;
/** Верхняя граница объектов, просматриваемых за один запуск (ограничивает CPU/время). */
export const CLEANUP_MAX_SCANNED_OBJECTS = 2000;
/** Верхняя граница удалений за один запуск. */
export const CLEANUP_MAX_DELETE_PER_RUN = 500;
/** Размер батча для повторной проверки и вызова delete API. */
export const CLEANUP_DELETE_BATCH_SIZE = 100;

export function isCardImagePath(path: string): boolean {
  return CARD_IMAGE_PATH_PATTERN.test(path);
}

export function isPastGracePeriod(createdAt: Date, now: Date): boolean {
  const graceMs = CLEANUP_GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000;
  return now.getTime() - createdAt.getTime() >= graceMs;
}

export interface OrphanSelection {
  candidates: string[];
  skippedInvalidPath: string[];
  skippedTooRecent: string[];
}

/**
 * Чистая фильтрация одной страницы объектов: невалидный путь → отбрасывается независимо от
 * возраста/ссылок; валидный, но моложе grace period → пропускается; валидный, старше grace
 * period и без ссылки в card_images → кандидат на удаление.
 */
export function selectOrphanCandidates(
  objects: StorageObjectSummary[],
  referenced: Set<string>,
  now: Date
): OrphanSelection {
  const candidates: string[] = [];
  const skippedInvalidPath: string[] = [];
  const skippedTooRecent: string[] = [];

  for (const object of objects) {
    if (!isCardImagePath(object.storagePath)) {
      skippedInvalidPath.push(object.storagePath);
      continue;
    }
    if (referenced.has(object.storagePath)) continue;
    if (!isPastGracePeriod(object.createdAt, now)) {
      skippedTooRecent.push(object.storagePath);
      continue;
    }
    candidates.push(object.storagePath);
  }

  return { candidates, skippedInvalidPath, skippedTooRecent };
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

export interface CleanupSummary {
  dryRun: boolean;
  scanned: number;
  candidates: number;
  skippedInvalidPath: number;
  skippedTooRecent: number;
  deleted: number;
  failed: number;
  durationMs: number;
}

/**
 * Уборка orphaned-объектов бакета card-images под префиксом cards/: постранично сверяет их с
 * card_images.storage_path, отбирает кандидатов старше CLEANUP_GRACE_PERIOD_DAYS и, если не
 * dry-run, повторно подтверждает отсутствие ссылки непосредственно перед строгим удалением.
 * Идемпотентна: состояние между запусками не хранится, уже удалённые объекты просто не попадут
 * в следующий listing.
 */
export async function runStorageCleanup(env: AppEnv): Promise<CleanupSummary> {
  const startedAt = Date.now();
  const dryRun = env.STORAGE_CLEANUP_DRY_RUN !== "false";
  const now = new Date();

  let scanned = 0;
  let skippedInvalidPath = 0;
  let skippedTooRecent = 0;
  const orphanCandidates: string[] = [];

  let offset = 0;
  while (scanned < CLEANUP_MAX_SCANNED_OBJECTS && orphanCandidates.length < CLEANUP_MAX_DELETE_PER_RUN) {
    const page = await listCardImageObjects(env, { limit: CLEANUP_LIST_PAGE_SIZE, offset });
    if (page.length === 0) break;
    scanned += page.length;
    offset += page.length;

    const referenced = await findReferencedStoragePaths(
      env,
      page.filter((object) => isCardImagePath(object.storagePath)).map((object) => object.storagePath)
    );
    const selection = selectOrphanCandidates(page, referenced, now);
    skippedInvalidPath += selection.skippedInvalidPath.length;
    skippedTooRecent += selection.skippedTooRecent.length;
    orphanCandidates.push(
      ...selection.candidates.slice(0, CLEANUP_MAX_DELETE_PER_RUN - orphanCandidates.length)
    );

    if (page.length < CLEANUP_LIST_PAGE_SIZE) break;
  }

  let deleted = 0;
  let failed = 0;

  if (!dryRun && orphanCandidates.length > 0) {
    for (const batch of chunk(orphanCandidates, CLEANUP_DELETE_BATCH_SIZE)) {
      const stillReferenced = await findReferencedStoragePaths(env, batch);
      const confirmed = batch.filter((path) => !stillReferenced.has(path));
      const result = await deleteStorageObjectsStrict(env, confirmed);
      deleted += result.deleted.length;
      failed += result.failed.length;
    }
  }

  const summary: CleanupSummary = {
    dryRun,
    scanned,
    candidates: orphanCandidates.length,
    skippedInvalidPath,
    skippedTooRecent,
    deleted,
    failed,
    durationMs: Date.now() - startedAt
  };

  console.info("storageCleanup: run complete", summary);
  if (dryRun && orphanCandidates.length > 0) {
    console.info("storageCleanup: dry-run candidates", orphanCandidates);
  }

  return summary;
}
