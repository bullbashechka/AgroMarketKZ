import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import postgres from "postgres";

const databaseUrl = Bun.env.DEV_DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DEV_DATABASE_URL обязателен; seed никогда не принимает production DATABASE_URL");
}
if (Bun.env.TARGET_ENV !== "development") {
  throw new Error("Для seed укажите TARGET_ENV=development");
}

const sql = postgres(databaseUrl, { max: 1, connect_timeout: 10, prepare: false });
try {
  const seed = await readFile(resolve(import.meta.dir, "../../database/seeds/dev.sql"), "utf8");
  await sql.unsafe(seed);
  console.info("Development seed применён");
} finally {
  await sql.end({ timeout: 5 });
}
