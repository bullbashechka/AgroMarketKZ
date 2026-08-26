import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync, readlinkSync, realpathSync } from "node:fs";
import { resolve } from "node:path";

type LegacyRemoteMigration = {
  file: string;
  version: string;
  sha256: string;
};

type ManagedMigration = {
  canonicalFile: string;
  sha256: string;
  historical?: boolean;
  supabaseVersion?: string;
  supabaseFile?: string;
  compatibility?: string;
  forwardRecovery?: string;
  rollback?: string;
  verificationSql?: string;
  requiresPitr?: boolean;
};

export type MigrationManifest = {
  schemaVersion: number;
  sourceOfTruth: string;
  productionProjectRef: string;
  legacyRemoteHistory: LegacyRemoteMigration[];
  migrations: ManagedMigration[];
};

const canonicalPattern = /^\d{4}_.+\.sql$/;
const supabasePattern = /^(\d{14})_.+\.sql$/;
const sha256Pattern = /^[a-f0-9]{64}$/;

function checksum(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Migration fitness check failed: ${message}`);
}

function assertMetadata(migration: ManagedMigration): void {
  if (migration.historical) {
    assert(!migration.supabaseFile && !migration.supabaseVersion, `${migration.canonicalFile}: historical migration cannot have a managed Supabase mapping`);
    return;
  }

  assert(Boolean(migration.supabaseVersion?.match(/^\d{14}$/)), `${migration.canonicalFile}: supabaseVersion must have 14 digits`);
  assert(Boolean(migration.supabaseFile?.match(supabasePattern)), `${migration.canonicalFile}: supabaseFile must use a 14-digit Supabase version`);
  assert(migration.supabaseFile!.startsWith(`${migration.supabaseVersion}_`), `${migration.canonicalFile}: Supabase filename/version mismatch`);
  for (const field of ["compatibility", "forwardRecovery", "rollback", "verificationSql"] as const) {
    assert(typeof migration[field] === "string" && migration[field]!.trim().length >= 12, `${migration.canonicalFile}: ${field} is required`);
  }
  assert(typeof migration.requiresPitr === "boolean", `${migration.canonicalFile}: requiresPitr must be explicit`);
}

export function loadMigrationManifest(repoRoot = resolve(import.meta.dir, "../..")): MigrationManifest {
  const path = resolve(repoRoot, "database/migrations/manifest.json");
  const manifest = JSON.parse(readFileSync(path, "utf8")) as MigrationManifest;
  assert(manifest.schemaVersion === 1, "unsupported manifest schemaVersion");
  assert(manifest.sourceOfTruth === "database/migrations", "database/migrations must be the source of truth");
  assert(Boolean(manifest.productionProjectRef.match(/^[a-z0-9]{20}$/)), "productionProjectRef must be a Supabase project ref");
  return manifest;
}

export function checkMigrations(repoRoot = resolve(import.meta.dir, "../..")): MigrationManifest {
  const manifest = loadMigrationManifest(repoRoot);
  const canonicalDir = resolve(repoRoot, "database/migrations");
  const supabaseDir = resolve(repoRoot, "supabase/migrations");
  const canonicalFiles = readdirSync(canonicalDir).filter((file) => canonicalPattern.test(file)).sort();
  const canonicalFromManifest = manifest.migrations.map((migration) => migration.canonicalFile);
  const expectedSupabaseFiles = new Set([
    ...manifest.legacyRemoteHistory.map((migration) => migration.file),
    ...manifest.migrations.flatMap((migration) => migration.supabaseFile ? [migration.supabaseFile] : []),
  ]);

  assert(new Set(canonicalFromManifest).size === canonicalFromManifest.length, "manifest has duplicate canonicalFile entries");
  assert([...canonicalFromManifest].sort().every((file, index) => file === canonicalFromManifest[index]), "manifest migrations must be ordered by canonical filename");
  assert(canonicalFiles.length === canonicalFromManifest.length && canonicalFiles.every((file, index) => file === canonicalFromManifest[index]), "canonical migration catalog and manifest are not a complete ordered bijection");

  const knownSupabaseVersions = new Set<string>();
  for (const legacy of manifest.legacyRemoteHistory) {
    assert(supabasePattern.test(legacy.file), `${legacy.file}: invalid legacy Supabase filename`);
    assert(legacy.file.startsWith(`${legacy.version}_`), `${legacy.file}: legacy filename/version mismatch`);
    assert(sha256Pattern.test(legacy.sha256), `${legacy.file}: invalid legacy checksum`);
    assert(!knownSupabaseVersions.has(legacy.version), `${legacy.file}: duplicate Supabase version`);
    knownSupabaseVersions.add(legacy.version);
    const path = resolve(supabaseDir, legacy.file);
    assert(!lstatSync(path).isSymbolicLink(), `${legacy.file}: historical remote evidence must be a regular file`);
    assert(checksum(path) === legacy.sha256, `${legacy.file}: frozen historical checksum changed`);
  }

  for (const migration of manifest.migrations) {
    assert(canonicalPattern.test(migration.canonicalFile), `${migration.canonicalFile}: invalid canonical filename`);
    assert(sha256Pattern.test(migration.sha256), `${migration.canonicalFile}: invalid checksum`);
    assertMetadata(migration);
    const canonicalPath = resolve(canonicalDir, migration.canonicalFile);
    assert(checksum(canonicalPath) === migration.sha256, `${migration.canonicalFile}: canonical checksum changed`);
    if (migration.historical) continue;

    assert(!knownSupabaseVersions.has(migration.supabaseVersion!), `${migration.canonicalFile}: duplicate Supabase version`);
    knownSupabaseVersions.add(migration.supabaseVersion!);
    const supabasePath = resolve(supabaseDir, migration.supabaseFile!);
    assert(lstatSync(supabasePath).isSymbolicLink(), `${migration.supabaseFile}: managed migration must be a symlink`);
    assert(readlinkSync(supabasePath) === `../../database/migrations/${migration.canonicalFile}`, `${migration.supabaseFile}: symlink target must be deterministic`);
    assert(realpathSync(supabasePath) === realpathSync(canonicalPath), `${migration.supabaseFile}: symlink does not resolve to canonical SQL`);
    assert(checksum(supabasePath) === migration.sha256, `${migration.supabaseFile}: checksum differs from canonical SQL`);
  }

  const actualSupabaseFiles = readdirSync(supabaseDir).filter((file) => file.endsWith(".sql")).sort();
  assert(actualSupabaseFiles.length === expectedSupabaseFiles.size && actualSupabaseFiles.every((file) => expectedSupabaseFiles.has(file)), "Supabase directory has missing or untracked migration files");
  return manifest;
}

if (import.meta.main) {
  const manifest = checkMigrations();
  console.info(`Migration fitness check passed: ${manifest.migrations.length} canonical migrations, ${manifest.legacyRemoteHistory.length} frozen remote history files.`);
}
