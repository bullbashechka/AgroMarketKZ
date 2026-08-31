import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { checkMigrations } from "./checkMigrations";
import { loadReleaseDescriptor, assertReleasePreflight, type ReleasePreflightSnapshot } from "./releaseDescriptor";

type CloudflareEnvelope = { success?: boolean; errors?: Array<{ message?: string }>; result?: unknown };

function run(command: string[]): string {
  const result = Bun.spawnSync(command, { stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error(`Release preflight failed: ${command.join(" ")} failed`);
  return result.stdout.toString();
}

function firstString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function typedBindingValues(version: unknown): string[] {
  const bindings = (version as { resources?: { bindings?: unknown } }).resources?.bindings;
  if (!Array.isArray(bindings)) throw new Error("Release preflight failed: active Worker version does not expose bindings");
  return bindings.flatMap((binding) => {
    if (typeof binding !== "object" || binding === null) return [];
    const record = binding as { type?: unknown; id?: unknown; queue_name?: unknown; queue?: unknown };
    if (record.type === "hyperdrive" && typeof record.id === "string") return [record.id];
    if ((record.type === "queue" || record.type === "queues") && typeof (record.queue_name ?? record.queue) === "string") return [String(record.queue_name ?? record.queue)];
    return [];
  });
}

function findCommit(value: unknown): string | null {
  if (typeof value === "string" && /^[a-f0-9]{40}$/.test(value)) return value;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findCommit(item);
      if (found) return found;
    }
  }
  if (typeof value === "object" && value !== null) {
    for (const item of Object.values(value)) {
      const found = findCommit(item);
      if (found) return found;
    }
  }
  return null;
}

async function cloudflareGet(path: string, token: string): Promise<unknown> {
  const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, { headers: { Authorization: `Bearer ${token}` } });
  const body = await response.json() as CloudflareEnvelope;
  if (!response.ok || body.success !== true) {
    throw new Error(`Release preflight failed: Cloudflare read failed for ${path}: ${body.errors?.[0]?.message ?? response.status}`);
  }
  return body.result;
}

function readToken(): string {
  const keychain = Bun.spawnSync(["security", "find-generic-password", "-s", "agromarketkz-cloudflare-deploy", "-w"], { stdout: "pipe", stderr: "pipe" });
  const token = keychain.exitCode === 0 ? keychain.stdout.toString().trim() : Bun.env.CLOUDFLARE_API_TOKEN?.trim();
  if (!token) throw new Error("Release preflight failed: a Cloudflare API token with Workers Scripts Read is required");
  return token;
}

function readRemoteMigrationVersions(): string[] {
  const stdout = run(["supabase", "--workdir", "..", "db", "query", "--linked", "--output", "json", "select version from supabase_migrations.schema_migrations order by version"]);
  const parsed = JSON.parse(stdout) as { rows?: Array<{ version?: unknown }> };
  if (!Array.isArray(parsed.rows) || parsed.rows.some((row) => typeof row.version !== "string")) throw new Error("Release preflight failed: Supabase ledger response is invalid");
  return parsed.rows.map((row) => row.version as string);
}

function readLinkedProjectRef(repoRoot: string): string {
  return readFileSync(resolve(repoRoot, "supabase/.temp/project-ref"), "utf8").trim();
}

function localDeploymentTarget(repoRoot: string) {
  const config = Bun.TOML.parse(readFileSync(resolve(repoRoot, "backend/wrangler.toml"), "utf8")) as {
    name?: unknown;
    account_id?: unknown;
    vars?: { CLOUDFLARE_ACCOUNT_ID?: unknown; WEBAPP_ORIGIN?: unknown };
    hyperdrive?: Array<{ id?: unknown }>;
    queues?: { producers?: Array<{ queue?: unknown }> };
  };
  const accountId = firstString(config.account_id);
  const workerName = firstString(config.name);
  const hyperdriveId = firstString(config.hyperdrive?.[0]?.id);
  const pagesProjectName = firstString(config.vars?.WEBAPP_ORIGIN)
    ?.match(/^https:\/\/([a-z0-9-]+)\.pages\.dev$/)?.[1] ?? null;
  const queueNames = config.queues?.producers?.map((item) => firstString(item.queue)).filter((item): item is string => Boolean(item)).sort() ?? [];
  if (!accountId || !workerName || !hyperdriveId || !pagesProjectName || queueNames.length === 0) throw new Error("Release preflight failed: local Wrangler target is incomplete");
  return { accountId, workerName, hyperdriveId, pagesProjectName, queueNames };
}

async function snapshotForDescriptor(descriptorPath: string): Promise<ReleasePreflightSnapshot> {
  const descriptor = loadReleaseDescriptor(descriptorPath);
  const repoRoot = resolve(import.meta.dir, "../..");
  if (run(["git", "status", "--porcelain"]).trim()) throw new Error("Release preflight failed: deployment requires a clean worktree");
  const localTarget = localDeploymentTarget(repoRoot);
  if (localTarget.accountId !== descriptor.resources.accountId || localTarget.workerName !== descriptor.resources.workerName
    || localTarget.hyperdriveId !== descriptor.resources.hyperdriveId || localTarget.pagesProjectName !== descriptor.resources.pagesProjectName
    || localTarget.queueNames.join("\n") !== [...descriptor.resources.queueNames].sort().join("\n")) {
    throw new Error("Release preflight failed: descriptor target differs from checked-out Wrangler configuration");
  }
  const manifest = checkMigrations(repoRoot);
  const migration = manifest.migrations.find((item) => item.supabaseVersion === descriptor.migration.version);
  if (!migration || migration.sha256 !== descriptor.migration.checksum) {
    throw new Error("Release preflight failed: descriptor migration does not match the checked-out manifest");
  }
  const proxyProtocolVersion = readFileSync(resolve(repoRoot, "webapp/functions/api/[[path]].js"), "utf8")
    .match(/const PROXY_PROTOCOL_VERSION = "(\d+)"/)?.[1];
  if (!proxyProtocolVersion) throw new Error("Release preflight failed: checked-out Pages proxy protocol is invalid");
  const token = readToken();
  const account = encodeURIComponent(localTarget.accountId);
  const worker = encodeURIComponent(localTarget.workerName);
  const deployments = await cloudflareGet(`/accounts/${account}/workers/scripts/${worker}/deployments`, token);
  const deploymentList = deployments as { deployments?: Array<{ versions?: Array<{ version_id?: unknown }> }> };
  const activeVersionIds = deploymentList.deployments?.[0]?.versions?.map((version) => firstString(version.version_id)).filter((value): value is string => Boolean(value)) ?? [];
  if (activeVersionIds.length === 0) throw new Error("Release preflight failed: no active Worker deployment was returned");
  const activeVersions = await Promise.all(activeVersionIds.map((versionId) => cloudflareGet(`/accounts/${account}/workers/scripts/${worker}/versions/${encodeURIComponent(versionId)}`, token)));
  const pagesProject = await cloudflareGet(`/accounts/${account}/pages/projects/${encodeURIComponent(localTarget.pagesProjectName)}`, token);
  const pagesProjectName = firstString((pagesProject as { name?: unknown }).name);
  if (!pagesProjectName) throw new Error("Release preflight failed: Pages project identity was not returned");
  const pagesCommit = findCommit((pagesProject as { canonical_deployment?: unknown }).canonical_deployment);
  if (!pagesCommit) throw new Error("Release preflight failed: Pages production deployment commit was not returned");
  return {
    commit: run(["git", "rev-parse", "HEAD"]).trim(),
    accountId: localTarget.accountId,
    workerName: localTarget.workerName,
    pagesProjectName,
    pagesCommit,
    activeVersionId: activeVersionIds.join(","),
    bindingValues: activeVersions.flatMap(typedBindingValues),
    appliedMigrationVersions: readRemoteMigrationVersions(),
    projectRef: readLinkedProjectRef(repoRoot),
    migrationChecksum: migration.sha256,
    proxyProtocolVersion,
  };
}

if (import.meta.main) {
  const descriptorPath = Bun.env.RELEASE_DESCRIPTOR?.trim();
  if (!descriptorPath) throw new Error("RELEASE_DESCRIPTOR must name an explicit release descriptor before deploy");
  const absolutePath = resolve(import.meta.dir, "../..", descriptorPath);
  const descriptor = loadReleaseDescriptor(absolutePath);
  const snapshot = await snapshotForDescriptor(absolutePath);
  assertReleasePreflight(descriptor, snapshot);
  console.info(`Release preflight passed for ${descriptor.commit}; active Worker version ${snapshot.activeVersionId}.`);
}
