import { checkMigrations, type MigrationManifest } from "./checkMigrations";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

type QueryResult = { rows?: Array<{ version?: string }> };

function run(command: string[], includeStderr = false): string {
  const result = Bun.spawnSync(command, { stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) {
    throw new Error(`${command.join(" ")} failed: ${result.stderr.toString().trim()}`);
  }
  return `${result.stdout.toString()}${includeStderr ? result.stderr.toString() : ""}`;
}

type PreflightContext = {
  workdir: string;
  cleanupDir: string;
  targetFile: string;
  targetVersion: string;
};

function requireExpectedMigration(manifest: MigrationManifest) {
  if (Bun.env.MIGRATION_TARGET_ENV !== "production") {
    throw new Error("MIGRATION_TARGET_ENV=production is required for linked Supabase preflight");
  }
  const version = Bun.env.MIGRATION_EXPECT_VERSION;
  if (!version?.match(/^\d{14}$/)) {
    throw new Error("MIGRATION_EXPECT_VERSION must be one explicit 14-digit Supabase version");
  }
  const migration = manifest.migrations.find((item) => item.supabaseVersion === version);
  if (!migration || migration.historical) {
    throw new Error(`MIGRATION_EXPECT_VERSION=${version} is not a managed migration in the manifest`);
  }
  return migration;
}

function readRemoteVersions(): string[] {
  const stdout = run([
    "supabase", "db", "query", "--linked", "--output", "json",
    "select version from supabase_migrations.schema_migrations order by version",
  ]);
  const parsed = JSON.parse(stdout) as QueryResult;
  if (!Array.isArray(parsed.rows) || parsed.rows.some((row) => typeof row.version !== "string")) {
    throw new Error("Supabase ledger query returned an unexpected JSON shape");
  }
  return parsed.rows.map((row) => row.version!);
}

function createCuratedWorkdir(manifest: MigrationManifest, allowedVersions: Set<string>): PreflightContext {
  const repositoryRoot = resolve(import.meta.dir, "../..");
  const sourceMigrations = resolve(repositoryRoot, "supabase/migrations");
  const workdir = mkdtempSync(join(tmpdir(), "agromarket-supabase-migration-"));
  const targetMigrations = resolve(workdir, "supabase/migrations");
  mkdirSync(targetMigrations, { recursive: true });
  mkdirSync(resolve(workdir, "supabase/.temp"), { recursive: true });
  writeFileSync(
    resolve(workdir, "supabase/.temp/project-ref"),
    readFileSync(resolve(repositoryRoot, "supabase/.temp/project-ref")),
  );
  copyFileSync(
    resolve(repositoryRoot, "supabase/.temp/pooler-url"),
    resolve(workdir, "supabase/.temp/pooler-url"),
  );
  const files = [
    ...manifest.legacyRemoteHistory.map((migration) => ({ version: migration.version, file: migration.file })),
    ...manifest.migrations.flatMap((migration) => migration.supabaseVersion && migration.supabaseFile
      ? [{ version: migration.supabaseVersion, file: migration.supabaseFile }]
      : []),
  ];
  for (const migration of files) {
    if (!allowedVersions.has(migration.version)) continue;
    copyFileSync(resolve(sourceMigrations, migration.file), resolve(targetMigrations, migration.file));
  }
  return { workdir, cleanupDir: workdir, targetFile: "", targetVersion: "" };
}

export function disposePreflight(context: PreflightContext): void {
  rmSync(context.cleanupDir, { recursive: true, force: true });
}

export function preflightSupabaseMigration(): PreflightContext {
  const manifest = checkMigrations();
  const target = requireExpectedMigration(manifest);
  const linkedProjectRef = readFileSync(resolve(import.meta.dir, "../../supabase/.temp/project-ref"), "utf8").trim();
  if (linkedProjectRef !== manifest.productionProjectRef) {
    throw new Error(`Linked Supabase project ${linkedProjectRef || "(missing)"} is not the production project declared in manifest`);
  }
  const knownVersions = [
    ...manifest.legacyRemoteHistory.map((item) => item.version),
    ...manifest.migrations.flatMap((item) => item.supabaseVersion ? [item.supabaseVersion] : []),
  ];
  const remoteVersions = readRemoteVersions();
  const remote = new Set(remoteVersions);
  const unexpected = remoteVersions.filter((version) => !knownVersions.includes(version));
  const expectedApplied = knownVersions.filter((version) => version < target.supabaseVersion!);
  const missingApplied = expectedApplied.filter((version) => !remote.has(version));
  const appliedAfterTarget = knownVersions.filter((version) => version > target.supabaseVersion! && remote.has(version));

  if (unexpected.length || missingApplied.length || remote.has(target.supabaseVersion!) || appliedAfterTarget.length) {
    throw new Error([
      "Supabase migration drift blocks deployment.",
      unexpected.length ? `unexpected remote: ${unexpected.join(", ")}` : "",
      missingApplied.length ? `missing expected remote: ${missingApplied.join(", ")}` : "",
      remote.has(target.supabaseVersion!) ? `target already applied: ${target.supabaseVersion}` : "",
      appliedAfterTarget.length ? `applied after target: ${appliedAfterTarget.join(", ")}` : "",
    ].filter(Boolean).join(" "));
  }
  if (target.requiresPitr && Bun.env.MIGRATION_PITR_CONFIRMED !== `PITR:${target.supabaseVersion}`) {
    throw new Error(`MIGRATION_PITR_CONFIRMED=PITR:${target.supabaseVersion} is required for destructive migration preflight`);
  }

  const context = createCuratedWorkdir(manifest, new Set([...expectedApplied, target.supabaseVersion!]));
  try {
    const dryRun = run(["supabase", "--workdir", context.workdir, "db", "push", "--linked", "--dry-run"], true);
    const laterFiles = manifest.migrations
      .filter((migration) => migration.supabaseVersion && migration.supabaseVersion > target.supabaseVersion!)
      .map((migration) => migration.supabaseFile!);
    if (!dryRun.includes(target.supabaseFile!) || laterFiles.some((file) => dryRun.includes(file))) {
      throw new Error(`Supabase dry-run did not list only expected file ${target.supabaseFile}: ${dryRun.trim()}`);
    }
  } catch (error) {
    disposePreflight(context);
    throw error;
  }
  return { ...context, targetFile: target.supabaseFile!, targetVersion: target.supabaseVersion! };
}

if (import.meta.main) {
  const context = preflightSupabaseMigration();
  try {
    console.info(`Preflight passed for ${context.targetFile}. Apply still requires MIGRATION_CONFIRM=APPLY:${context.targetVersion}.`);
  } finally {
    disposePreflight(context);
  }
}
