import { afterEach, describe, expect, test } from "bun:test";
import { cpSync, mkdtempSync, readFileSync, readlinkSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkMigrations } from "../scripts/checkMigrations";
import { syncMigrations } from "../scripts/syncMigrations";

const repositoryRoot = join(import.meta.dir, "../..");
const temporaryRoots: string[] = [];

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), "agromarket-migration-check-"));
  temporaryRoots.push(root);
  cpSync(join(repositoryRoot, "database"), join(root, "database"), { recursive: true });
  cpSync(join(repositoryRoot, "supabase"), join(root, "supabase"), { recursive: true, dereference: false });
  return root;
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("checkMigrations", () => {
  test("accepts the tracked canonical catalog and deterministic symlinks", () => {
    expect(checkMigrations(repositoryRoot).sourceOfTruth).toBe("database/migrations");
  });

  test("rejects a managed migration that is copied instead of symlinked", () => {
    const root = fixture();
    const path = join(root, "supabase/migrations/20260826080000_0021_admin_audit_outbox.sql");
    const target = readlinkSync(path);
    unlinkSync(path);
    cpSync(join(root, "supabase/migrations", target), path);
    expect(() => checkMigrations(root)).toThrow("managed migration must be a symlink");
  });

  test("rejects an untracked file", () => {
    const root = fixture();
    writeFileSync(join(root, "supabase/migrations/20990101010101_untracked.sql"), "-- untracked\n");
    expect(() => checkMigrations(root)).toThrow("missing or untracked migration files");
  });

  test("recreates only a missing deterministic managed symlink", () => {
    const root = fixture();
    const path = join(root, "supabase/migrations/20260826080000_0021_admin_audit_outbox.sql");
    unlinkSync(path);
    syncMigrations(root);
    expect(readlinkSync(path)).toBe("../../database/migrations/0021_admin_audit_outbox.sql");
  });

  test("rejects a dangling or wrong symlink target", () => {
    const root = fixture();
    const path = join(root, "supabase/migrations/20260826080000_0021_admin_audit_outbox.sql");
    unlinkSync(path);
    symlinkSync("../../database/migrations/0019_validate_application_constraints.sql", path);
    expect(() => checkMigrations(root)).toThrow("symlink target must be deterministic");
  });

  test("rejects canonical checksum drift", () => {
    const root = fixture();
    writeFileSync(join(root, "database/migrations/0021_admin_audit_outbox.sql"), "-- changed\n");
    expect(() => checkMigrations(root)).toThrow("canonical checksum changed");
  });

  test("requires recovery and verification metadata for every managed migration", () => {
    const root = fixture();
    const manifestPath = join(root, "database/migrations/manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    manifest.migrations.at(-1).verificationSql = "";
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    expect(() => checkMigrations(root)).toThrow("verificationSql is required");
  });
});
