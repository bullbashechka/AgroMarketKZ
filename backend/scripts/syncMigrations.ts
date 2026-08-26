import { existsSync, lstatSync, readlinkSync, symlinkSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { checkMigrations, loadMigrationManifest } from "./checkMigrations";

export function syncMigrations(root = resolve(import.meta.dir, "../..")): void {
  const supabaseDir = resolve(root, "supabase/migrations");
  const manifest = loadMigrationManifest(root);

  for (const migration of manifest.migrations) {
    if (migration.historical) continue;
    const path = resolve(supabaseDir, migration.supabaseFile!);
    const target = `../../database/migrations/${migration.canonicalFile}`;
    if (!existsSync(path)) {
      symlinkSync(target, path);
      console.info(`Created ${migration.supabaseFile}`);
      continue;
    }
    if (!lstatSync(path).isSymbolicLink() || readlinkSync(path) !== target) {
      throw new Error(`Refusing to replace existing ${migration.supabaseFile}; inspect migration drift first`);
    }
    if (resolve(dirname(path), readlinkSync(path)) !== resolve(root, "database/migrations", migration.canonicalFile)) {
      throw new Error(`Refusing non-canonical target for ${migration.supabaseFile}`);
    }
  }

  checkMigrations(root);
}

if (import.meta.main) {
  syncMigrations();
  console.info("Supabase migration symlinks are synchronized and verified.");
}
