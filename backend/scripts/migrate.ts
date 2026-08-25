import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import postgres from "postgres";

const databaseUrl = Bun.env.MIGRATION_DATABASE_URL;
const targetEnv = Bun.env.TARGET_ENV;
const baselineVersion = Bun.env.MIGRATION_BASELINE_VERSION;

if (!databaseUrl) {
  throw new Error("MIGRATION_DATABASE_URL обязателен; DATABASE_URL намеренно не используется миграционным runner");
}
if (targetEnv !== "development" && targetEnv !== "staging" && targetEnv !== "production") {
  throw new Error("TARGET_ENV должен быть development, staging или production");
}
if (targetEnv === "production" && Bun.env.MIGRATION_CONFIRM !== "APPLY") {
  throw new Error("Для production укажите MIGRATION_CONFIRM=APPLY в отдельной подтверждённой команде");
}
if (baselineVersion && !/^\d{4}$/.test(baselineVersion)) {
  throw new Error("MIGRATION_BASELINE_VERSION должен иметь формат NNNN, например 0013");
}

const migrationDir = resolve(import.meta.dir, "../../database/migrations");
const migrationFilePattern = /^(\d{4})_.+\.sql$/;

function checksum(sqlText: string): string {
  return createHash("sha256").update(sqlText).digest("hex");
}

async function assertKnownBaseline(sql: postgres.Sql, version: string): Promise<void> {
  const requiredTables = [
    "users", "categories", "cards", "card_images", "card_specs", "favorites",
    "requests", "feedback_messages", "platform_settings", "territories",
    "card_service_territories", "request_service_territories", "card_update_mutations",
  ];
  const rows = await sql<{ table_name: string; exists: boolean }[]>`
    select table_name, to_regclass('public.' || table_name) is not null as exists
    from unnest(${requiredTables}::text[]) as table_name
  `;
  const missing = rows.filter((row) => !row.exists).map((row) => row.table_name);
  if (missing.length > 0) {
    throw new Error(`Нельзя baseline до ${version}: отсутствуют таблицы ${missing.join(", ")}`);
  }
  if (version >= "0013") {
    const columns = await sql<{ table_name: string; column_name: string; exists: boolean }[]>`
      select required.table_name, required.column_name,
        exists (
          select 1 from information_schema.columns c
          where c.table_schema = 'public'
            and c.table_name = required.table_name
            and c.column_name = required.column_name
        ) as exists
      from (values
        ('cards', 'volume_tonnes'),
        ('cards', 'commodity_group'),
        ('categories', 'is_commodity'),
        ('requests', 'submission_volume_tonnes')
      ) as required(table_name, column_name)
    `;
    const missingColumns = columns
      .filter((column) => !column.exists)
      .map((column) => `${column.table_name}.${column.column_name}`);
    if (missingColumns.length > 0) {
      throw new Error(`Нельзя baseline до ${version}: отсутствуют колонки ${missingColumns.join(", ")}`);
    }
  }
}

const sql = postgres(databaseUrl, {
  max: 1,
  idle_timeout: 5,
  connect_timeout: 10,
  prepare: false,
});

try {
  await sql.unsafe(`
    create schema if not exists app_private;
    revoke all on schema app_private from public;
    create table if not exists app_private.schema_migrations (
      version text primary key,
      name text not null,
      checksum text not null,
      applied_at timestamptz not null default now()
    );
    revoke all on table app_private.schema_migrations from public;
    alter table app_private.schema_migrations enable row level security;
    do $block$
    begin
      if exists (select 1 from pg_roles where rolname = 'anon') then
        revoke all on table app_private.schema_migrations from anon;
      end if;
      if exists (select 1 from pg_roles where rolname = 'authenticated') then
        revoke all on table app_private.schema_migrations from authenticated;
      end if;
    end
    $block$;
  `);
  await sql`select pg_advisory_lock(hashtextextended('agromarketkz:migrations', 0))`;

  const files = (await readdir(migrationDir))
    .filter((file) => migrationFilePattern.test(file))
    .sort();
  if (files.length === 0) throw new Error(`Миграции не найдены: ${migrationDir}`);

  const applied = await sql<{ version: string; name: string; checksum: string }[]>`
    select version, name, checksum
    from app_private.schema_migrations
    order by version
  `;
  const appliedByVersion = new Map(applied.map((row) => [row.version, row]));

  if (applied.length === 0 && baselineVersion) {
    await assertKnownBaseline(sql, baselineVersion);
    const baselineFiles = files.filter((file) => (file.match(migrationFilePattern)?.[1] ?? "") <= baselineVersion);
    if (baselineFiles.length === 0 || baselineFiles.at(-1)?.slice(0, 4) !== baselineVersion) {
      throw new Error(`Файл baseline ${baselineVersion} не найден`);
    }
    for (const file of baselineFiles) {
      const version = file.slice(0, 4);
      const text = await readFile(resolve(migrationDir, file), "utf8");
      await sql`
        insert into app_private.schema_migrations (version, name, checksum)
        values (${version}, ${file}, ${checksum(text)})
      `;
      appliedByVersion.set(version, { version, name: file, checksum: checksum(text) });
    }
    console.info(`Baseline зарегистрирован до ${baselineVersion} (${baselineFiles.length} файлов)`);
  }

  for (const file of files) {
    const match = file.match(migrationFilePattern);
    if (!match) continue;
    const version = match[1]!;
    const text = await readFile(resolve(migrationDir, file), "utf8");
    const digest = checksum(text);
    const previous = appliedByVersion.get(version);
    if (previous) {
      if (previous.name !== file || previous.checksum !== digest) {
        throw new Error(`Checksum миграции ${file} не совпадает с ledger`);
      }
      continue;
    }

    console.info(`Applying ${file}`);
    // Existing repository migrations own their BEGIN/COMMIT boundaries. The
    // advisory lock prevents concurrent runners; the ledger row is written
    // only after the SQL file has completed successfully.
    await sql.unsafe(text);
    await sql`
      insert into app_private.schema_migrations (version, name, checksum)
      values (${version}, ${file}, ${digest})
    `;
  }

  const remaining = await sql<{ version: string }[]>`
    select version from app_private.schema_migrations
    where version <> all(${files.map((file) => file.slice(0, 4))}::text[])
  `;
  if (remaining.length > 0) {
    throw new Error(`В ledger найдены миграции, которых нет в checkout: ${remaining.map((row) => row.version).join(", ")}`);
  }
  console.info("Миграции применены и проверены через app_private.schema_migrations");
} finally {
  await sql`select pg_advisory_unlock(hashtextextended('agromarketkz:migrations', 0))`.catch(() => {});
  await sql.end({ timeout: 5 });
}
