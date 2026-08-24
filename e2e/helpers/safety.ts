const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

export interface DatabaseIdentity {
  host: string;
  port: number;
  database: string;
  projectRef: string | null;
}

function requireValue(name: string, value: string | undefined): string {
  if (!value) throw new Error(`${name} is required for isolated e2e tests`);
  return value;
}

function parseUrl(name: string, value: string, protocols: string[]): URL {
  const parsed = new URL(requireValue(name, value));
  if (!protocols.includes(parsed.protocol)) {
    throw new Error(`${name} must use ${protocols.join(" or ")}`);
  }
  return parsed;
}

function decodePart(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function projectRefFromDatabase(url: URL): string | null {
  const username = decodePart(url.username).trim().toLowerCase();
  const userMatch = /^postgres\.([a-z0-9-]+)$/.exec(username);
  if (userMatch) return userMatch[1] ?? null;
  const hostMatch = /^(?:db\.)?([a-z0-9-]+)\.supabase\.co$/.exec(url.hostname.toLowerCase());
  return hostMatch?.[1] ?? null;
}

/** Parsed identity intentionally ignores pooler query-string formatting. */
export function databaseIdentity(value: string): DatabaseIdentity {
  const url = parseUrl("DATABASE_URL", value, ["postgres:", "postgresql:"]);
  return {
    host: url.hostname.toLowerCase().replace(/\.$/, ""),
    port: Number(url.port) || 5432,
    database: decodePart(url.pathname).replace(/^\/+|\/+$/g, "").toLowerCase(),
    projectRef: projectRefFromDatabase(url),
  };
}

export function supabaseProjectIdentity(value: string): string {
  const url = parseUrl("SUPABASE_URL", value, ["http:", "https:"]);
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  return host.endsWith(".supabase.co") ? host.slice(0, -".supabase.co".length) : host;
}

function jwtProjectRef(value: string | undefined): string | null {
  if (!value) return null;
  const parts = value.trim().split(".");
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1]!, "base64url").toString("utf8")) as { ref?: unknown };
    return typeof payload.ref === "string" ? payload.ref.trim().toLowerCase() : null;
  } catch {
    return null;
  }
}

function sameCredential(testValue: string, productionValue: string | undefined): boolean {
  if (!productionValue) return false;
  if (testValue.trim() === productionValue.trim()) return true;
  const testRef = jwtProjectRef(testValue);
  const productionRef = jwtProjectRef(productionValue);
  return testRef !== null && testRef === productionRef;
}

export interface E2ESafetyInput {
  apiUrl?: string;
  baseUrl?: string;
  databaseUrl?: string;
  supabaseUrl?: string;
  storageBucket?: string;
  telegramBotToken?: string;
  jwtSecret?: string;
  storageServiceKey?: string;
  productionApiUrl?: string;
  productionDatabaseUrl?: string;
  productionSupabaseUrl?: string;
  productionTelegramBotToken?: string;
  productionJwtSecret?: string;
  productionStorageServiceKey?: string;
}

/** Проверяет конфигурацию до запуска backend/webapp и до любого логина или mutation. */
export function assertSafeE2EEnvironment(input: E2ESafetyInput): void {
  const apiUrl = parseUrl("E2E_API_URL", input.apiUrl ?? "", ["http:"]);
  const baseUrl = parseUrl("E2E_BASE_URL", input.baseUrl ?? "", ["http:"]);
  if (!LOOPBACK_HOSTS.has(apiUrl.hostname) || !LOOPBACK_HOSTS.has(baseUrl.hostname)) {
    throw new Error("E2E_API_URL and E2E_BASE_URL must point to loopback hosts");
  }

  const databaseUrl = parseUrl("E2E_DATABASE_URL", input.databaseUrl ?? "", ["postgres:", "postgresql:"]);
  const supabaseUrl = parseUrl("E2E_SUPABASE_URL", input.supabaseUrl ?? "", ["http:", "https:"]);
  requireValue("E2E_SUPABASE_STORAGE_BUCKET", input.storageBucket);
  requireValue("E2E_TELEGRAM_BOT_TOKEN", input.telegramBotToken);
  requireValue("E2E_JWT_SECRET", input.jwtSecret);
  requireValue("E2E_SUPABASE_SERVICE_ROLE_KEY", input.storageServiceKey);

  const productionApiUrl = input.productionApiUrl;
  const productionDatabaseUrl = input.productionDatabaseUrl;
  const productionSupabaseUrl = input.productionSupabaseUrl;
  const hasProductionBaseline = Boolean(
    productionApiUrl
      && productionDatabaseUrl
      && productionSupabaseUrl
      && input.productionTelegramBotToken
      && input.productionJwtSecret
      && input.productionStorageServiceKey,
  );
  const usesRemoteDatabase = !LOOPBACK_HOSTS.has(databaseUrl.hostname);
  const usesRemoteSupabase = !LOOPBACK_HOSTS.has(supabaseUrl.hostname);
  if (!hasProductionBaseline && (usesRemoteDatabase || usesRemoteSupabase)) {
    throw new Error(
      "Production baseline is required before running E2E against remote database or Supabase resources",
    );
  }
  if (productionApiUrl && apiUrl.toString().replace(/\/$/, "") === productionApiUrl.replace(/\/$/, "")) {
    throw new Error("E2E_API_URL points to the production API");
  }
  if (productionDatabaseUrl) {
    const e2eDatabase = databaseIdentity(databaseUrl.toString());
    const productionDatabase = databaseIdentity(productionDatabaseUrl);
    const sameProject = e2eDatabase.projectRef !== null
      && e2eDatabase.projectRef === productionDatabase.projectRef;
    const sameDatabase = e2eDatabase.host === productionDatabase.host
      && e2eDatabase.port === productionDatabase.port
      && e2eDatabase.database === productionDatabase.database;
    if (sameProject || sameDatabase) throw new Error("E2E_DATABASE_URL points to the production database");
  }
  if (productionSupabaseUrl && supabaseProjectIdentity(supabaseUrl.toString()) === supabaseProjectIdentity(productionSupabaseUrl)) {
    throw new Error("E2E_SUPABASE_URL points to the production project");
  }
  if (input.productionTelegramBotToken && sameCredential(input.telegramBotToken!, input.productionTelegramBotToken)) {
    throw new Error("E2E_TELEGRAM_BOT_TOKEN must not reuse the production bot token");
  }
  if (input.productionJwtSecret && sameCredential(input.jwtSecret!, input.productionJwtSecret)) {
    throw new Error("E2E_JWT_SECRET must not reuse the production JWT secret");
  }
  const productionProject = productionSupabaseUrl ? supabaseProjectIdentity(productionSupabaseUrl) : null;
  const e2eKeyProject = jwtProjectRef(input.storageServiceKey);
  if (
    (input.productionStorageServiceKey && sameCredential(input.storageServiceKey!, input.productionStorageServiceKey))
    || (productionProject !== null && e2eKeyProject === productionProject)
  ) {
    throw new Error("E2E_SUPABASE_SERVICE_ROLE_KEY must not reuse the production key");
  }
}
