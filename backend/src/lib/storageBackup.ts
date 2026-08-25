import type { AppEnv } from "../env";
import { downloadStorageObject, listCardImageObjects } from "./storage";

const BACKUP_PAGE_SIZE = 100;
const BACKUP_MAX_OBJECTS = 200;
const BACKUP_MAX_BYTES = 64 * 1024 * 1024;
const OBJECT_MAX_BYTES = 8 * 1024 * 1024;

export interface StorageBackupSummary {
  skipped: boolean;
  complete: boolean;
  scanned: number;
  copied: number;
  failed: number;
  bytes: number;
  manifestKey: string | null;
  durationMs: number;
}

function dayKey(now: Date): string {
  return now.toISOString().slice(0, 10);
}

async function sha256Hex(value: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", value);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function readBounded(response: Response, maxBytes: number): Promise<ArrayBuffer | null> {
  if (!response.body) return null;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result.buffer;
}

/**
 * Copies a bounded daily snapshot of Supabase card images to a versioned,
 * private R2 bucket. Versioned keys are compatible with a 90-day Bucket Lock:
 * no overwrite/delete is needed to retain independent recovery points. The
 * manifest says `complete: false` when the configured safety budget is hit or
 * an object could not be copied; operators must not treat that snapshot as a
 * complete recovery point.
 */
export async function runStorageBackup(env: AppEnv): Promise<StorageBackupSummary> {
  const startedAt = Date.now();
  const backup = env.STORAGE_BACKUP;
  if (!backup) {
    console.warn("storageBackup: STORAGE_BACKUP binding is not configured; no independent snapshot was created");
    return {
      skipped: true,
      complete: false,
      scanned: 0,
      copied: 0,
      failed: 0,
      bytes: 0,
      manifestKey: null,
      durationMs: Date.now() - startedAt,
    };
  }

  // A retry must never overwrite a locked R2 object. Keep the calendar day
  // for operator discovery and add a CSPRNG run id for immutability.
  const snapshot = `${dayKey(new Date())}-${crypto.randomUUID()}`;
  const manifest: Array<{ storagePath: string; key: string; sha256: string; bytes: number }> = [];
  let scanned = 0;
  let copied = 0;
  let failed = 0;
  let bytes = 0;
  let offset = 0;
  let exhausted = false;

  while (true) {
    if (scanned >= BACKUP_MAX_OBJECTS || bytes >= BACKUP_MAX_BYTES) {
      // Probe one more page so an exactly-full final page is not falsely
      // reported as truncated. If an object exists beyond either bound, the
      // manifest remains useful but is explicitly marked incomplete.
      const probe = await listCardImageObjects(env, { limit: 1, offset });
      exhausted = probe.length === 0;
      break;
    }
    const page = await listCardImageObjects(env, { limit: BACKUP_PAGE_SIZE, offset });
    if (page.length === 0) {
      exhausted = true;
      break;
    }
    scanned += page.length;
    offset += page.length;

    for (const object of page) {
      if (copied + failed >= BACKUP_MAX_OBJECTS || bytes >= BACKUP_MAX_BYTES) break;
      const response = await downloadStorageObject(env, object.storagePath);
      if (!response.ok) {
        failed += 1;
        console.error("storageBackup: failed to download object", { path: object.storagePath, status: response.status });
        continue;
      }
      const declaredLength = Number(response.headers.get("content-length") ?? "0");
      if (declaredLength > OBJECT_MAX_BYTES || declaredLength + bytes > BACKUP_MAX_BYTES) {
        failed += 1;
        console.error("storageBackup: object exceeds bounded backup budget", { path: object.storagePath, declaredLength });
        continue;
      }
      const body = await readBounded(response, Math.min(OBJECT_MAX_BYTES, BACKUP_MAX_BYTES - bytes));
      if (!body || body.byteLength > OBJECT_MAX_BYTES || body.byteLength + bytes > BACKUP_MAX_BYTES) {
        failed += 1;
        continue;
      }
      const digest = await sha256Hex(body);
      const key = `snapshots/${snapshot}/${object.storagePath}`;
      await backup.put(key, body, {
        httpMetadata: { contentType: response.headers.get("content-type") ?? "application/octet-stream" },
        customMetadata: { sha256: digest, source: object.storagePath },
      });
      manifest.push({ storagePath: object.storagePath, key, sha256: digest, bytes: body.byteLength });
      copied += 1;
      bytes += body.byteLength;
    }

    if (page.length < BACKUP_PAGE_SIZE) {
      exhausted = true;
      break;
    }
  }

  const manifestKey = `manifests/${snapshot}.json`;
  const complete = exhausted && failed === 0;
  await backup.put(manifestKey, JSON.stringify({
    snapshot,
    complete,
    scanned,
    copied,
    failed,
    bytes,
    objects: manifest,
  }), {
    httpMetadata: { contentType: "application/json" },
  });
  const summary = {
    skipped: false,
    complete,
    scanned,
    copied,
    failed,
    bytes,
    manifestKey,
    durationMs: Date.now() - startedAt,
  } satisfies StorageBackupSummary;
  if (!complete) console.error("storageBackup: snapshot is incomplete", summary);
  else console.info("storageBackup: run complete", summary);
  return summary;
}
