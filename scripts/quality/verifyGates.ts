import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ESLint } from "eslint";
import { checkMigrations, type MigrationManifest } from "../../backend/scripts/checkMigrations";

const repoRoot = resolve(import.meta.dir, "../..");

function verifyTypeScriptMajor(): void {
  const packagePath = join(repoRoot, "node_modules/typescript/package.json");
  const packageMetadata = JSON.parse(readFileSync(packagePath, "utf8")) as { version?: unknown };
  const version = typeof packageMetadata.version === "string" ? packageMetadata.version : "";
  const major = Number(version.split(".")[0]);
  if (!Number.isInteger(major) || major < 1 || major >= 7) {
    throw new Error(`Quality gate probe failed: TypeScript must remain below 7; found ${version || "unknown"}.`);
  }
}

async function verifyFloatingPromiseGate(): Promise<void> {
  const eslint = new ESLint({ cwd: repoRoot, ignore: false });
  const reports = await eslint.lintFiles([join(repoRoot, "scripts/quality/fixtures/floatingPromise.fixture.ts")]);
  const caught = reports.some((report) => report.messages.some((message) => message.ruleId === "@typescript-eslint/no-floating-promises"));
  if (!caught) throw new Error("Quality gate probe failed: an intentional floating promise was not rejected.");
}

function verifyMigrationDriftGate(): void {
  const probeRoot = mkdtempSync(join(tmpdir(), "agromarket-quality-migration-"));
  try {
    cpSync(join(repoRoot, "database/migrations"), join(probeRoot, "database/migrations"), { recursive: true });
    cpSync(join(repoRoot, "supabase/migrations"), join(probeRoot, "supabase/migrations"), { recursive: true, dereference: false });
    const manifestPath = join(probeRoot, "database/migrations/manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as MigrationManifest;
    const firstMigration = manifest.migrations[0];
    if (!firstMigration) throw new Error("Quality gate probe failed: migration manifest is empty.");
    firstMigration.sha256 = "0".repeat(64);
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

    let rejected = false;
    try {
      checkMigrations(probeRoot);
    } catch {
      rejected = true;
    }
    if (!rejected) throw new Error("Quality gate probe failed: intentional migration checksum drift was not rejected.");
  } finally {
    rmSync(probeRoot, { recursive: true, force: true });
  }
}

await verifyFloatingPromiseGate();
verifyTypeScriptMajor();
verifyMigrationDriftGate();
console.info("Quality probes passed: floating promise, TypeScript 7, and migration drift are rejected.");
