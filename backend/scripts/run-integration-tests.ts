import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { checkMigrations } from "./checkMigrations";
import { findFreePort } from "./integrationPort";

function executable(name: string): string {
  const result = Bun.spawnSync(["which", name]);
  const path = result.stdout.toString().trim();
  if (result.exitCode !== 0 || !path) throw new Error(`${name} is required for integration tests`);
  return path;
}

function run(command: string[], options: Parameters<typeof Bun.spawnSync>[1] = {}) {
  const result = Bun.spawnSync(command, { ...options, stdout: "inherit", stderr: "inherit" });
  if (result.exitCode !== 0) throw new Error(`${command[0]} exited with ${result.exitCode}`);
}

const initdb = executable("initdb");
const pgCtl = executable("pg_ctl");
const psql = executable("psql");
const migrationsDir = resolve(import.meta.dir, "../../database/migrations");

function applyMigrations(databaseUrl: string, migrations: string[]) {
  for (const migration of migrations) {
    run([psql, databaseUrl, "-v", "ON_ERROR_STOP=1", "-f", join(migrationsDir, migration)]);
  }
}

const testNamePattern = process.env.INTEGRATION_TEST_NAME_PATTERN;
const allIntegrationTests = [
  "backend/tests/adminCatalog.integration.test.ts",
  "backend/tests/sessions.integration.test.ts",
  "backend/tests/notificationOutbox.test.ts",
  "backend/tests/adminAudit.test.ts",
  "backend/tests/privacy.test.ts",
  "backend/tests/runtimeCapabilities.integration.test.ts",
];
const requestedIntegrationTests = process.env.INTEGRATION_TEST_FILES
  ?.split(",")
  .map((path) => path.trim())
  .filter(Boolean);
const integrationTests = requestedIntegrationTests?.length ? requestedIntegrationTests : allIntegrationTests;
const unsupportedIntegrationTests = integrationTests.filter((path) => !allIntegrationTests.includes(path));
if (unsupportedIntegrationTests.length > 0) {
  throw new Error(`Unsupported integration test files: ${unsupportedIntegrationTests.join(", ")}`);
}
const dataDir = mkdtempSync(join(tmpdir(), "agromarketkz-pg-"));
const port = await findFreePort();
const databaseUrl = `postgresql://127.0.0.1:${port}/postgres`;
let serverStarted = false;

try {
  const manifest = checkMigrations();
  const latestManagedMigration = manifest.migrations.at(-1);
  if (!latestManagedMigration?.verificationSql) {
    throw new Error("Latest migration must define a verification query");
  }
  run([
    initdb,
    "-D",
    dataDir,
    "--no-locale",
    "--encoding=UTF8",
    "-A",
    "trust",
    "-c",
    "dynamic_shared_memory_type=posix",
    "-c",
    "shared_memory_type=mmap",
  ]);
  run([pgCtl, "-D", dataDir, "-w", "start", "-o", `-p ${port} -h 127.0.0.1`, "-l", join(dataDir, "server.log")]);
  serverStarted = true;
  run([psql, databaseUrl, "-v", "ON_ERROR_STOP=1", "-c", "create role agromarket_runtime nologin nosuperuser nocreatedb nocreaterole noinherit bypassrls"]);

  const migrations = Array.from(new Bun.Glob("*.sql").scanSync({ cwd: migrationsDir })).sort();
  applyMigrations(databaseUrl, migrations);
  run([psql, databaseUrl, "-v", "ON_ERROR_STOP=1", "-c", "grant usage on schema app_private to agromarket_runtime"]);

  const upgradeDatabase = "migration_upgrade";
  const upgradeDatabaseUrl = `postgresql://127.0.0.1:${port}/${upgradeDatabase}`;
  run([psql, databaseUrl, "-v", "ON_ERROR_STOP=1", "-c", `create database ${upgradeDatabase}`]);
  applyMigrations(upgradeDatabaseUrl, migrations.slice(0, -1));
  applyMigrations(upgradeDatabaseUrl, migrations.slice(-1));
  run([psql, upgradeDatabaseUrl, "-v", "ON_ERROR_STOP=1", "-c", latestManagedMigration.verificationSql]);

  for (const integrationTest of integrationTests) {
    const command = [process.execPath, "test", integrationTest];
    if (testNamePattern) command.push("--test-name-pattern", testNamePattern);
    run(command, {
      env: {
        ...process.env,
        TEST_DATABASE_URL: databaseUrl,
      },
    });
  }
} finally {
  try {
    if (serverStarted) run([pgCtl, "-D", dataDir, "-w", "stop", "-m", "immediate"]);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
}
