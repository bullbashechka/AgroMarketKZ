import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { checkMigrations } from "./checkMigrations";
import { RELEASE_DESCRIPTOR_VERSION, REQUIRED_GATE_STEPS, releaseGateDigest, releaseGateStepDigest, type ReleaseDescriptor } from "./releaseDescriptor";

function run(command: string[]): string {
  const result = Bun.spawnSync(command, { stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error(`Release descriptor failed: ${command.join(" ")} failed`);
  return result.stdout.toString();
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`Release descriptor failed: ${name} is missing from wrangler.toml`);
  return value;
}

function queueNames(config: Record<string, unknown>): string[] {
  const queues = config.queues as { producers?: Array<{ queue?: unknown }> } | undefined;
  const names = queues?.producers?.map((item) => requiredString(item.queue, "queues.producers[].queue")) ?? [];
  if (names.length === 0 || new Set(names).size !== names.length) throw new Error("Release descriptor failed: queue identities are invalid");
  return names.sort();
}

function createDescriptor(repoRoot: string, commit: string): ReleaseDescriptor {
  const manifest = checkMigrations(repoRoot);
  const migration = [...manifest.migrations].reverse().find((item) => !item.historical);
  if (!migration?.supabaseVersion) throw new Error("Release descriptor failed: no managed migration exists");
  const config = Bun.TOML.parse(readFileSync(resolve(repoRoot, "backend/wrangler.toml"), "utf8")) as Record<string, unknown>;
  const vars = config.vars as Record<string, unknown> | undefined;
  const hyperdrive = config.hyperdrive as Array<{ id?: unknown }> | undefined;
  const proxy = readFileSync(resolve(repoRoot, "webapp/functions/api/[[path]].js"), "utf8").match(/const PROXY_PROTOCOL_VERSION = "(\d+)"/);
  if (!proxy) throw new Error("Release descriptor failed: proxy protocol version is not declared");
  const requestedChangeKind = Bun.env.RELEASE_CHANGE_KIND?.trim();
  if (requestedChangeKind !== undefined && requestedChangeKind !== "code" && requestedChangeKind !== "configuration") {
    throw new Error("Release descriptor failed: RELEASE_CHANGE_KIND must be code or configuration");
  }
  const pagesProjectName = new URL(requiredString(vars?.WEBAPP_ORIGIN, "vars.WEBAPP_ORIGIN")).hostname.match(/^([a-z0-9-]+)\.pages\.dev$/)?.[1];
  if (!pagesProjectName) throw new Error("Release descriptor failed: WEBAPP_ORIGIN must name a Pages production project");
  return {
    version: RELEASE_DESCRIPTOR_VERSION,
    commit,
    createdAt: new Date().toISOString(),
    changeKind: requestedChangeKind ?? "code",
    migration: {
      projectRef: manifest.productionProjectRef,
      version: migration.supabaseVersion,
      checksum: migration.sha256,
      expectedLedger: [
        ...manifest.legacyRemoteHistory.map((item) => item.version),
        ...manifest.migrations.flatMap((item) => item.supabaseVersion ? [item.supabaseVersion] : []),
      ],
    },
    proxyProtocolVersion: proxy[1]!,
    resources: {
      accountId: requiredString(vars?.CLOUDFLARE_ACCOUNT_ID, "vars.CLOUDFLARE_ACCOUNT_ID"),
      workerName: requiredString(config.name, "name"),
      pagesProjectName,
      hyperdriveId: requiredString(hyperdrive?.[0]?.id, "hyperdrive[0].id"),
      queueNames: queueNames(config),
    },
    gates: {
      command: "bun run release:verify",
      result: "passed",
      digest: releaseGateDigest(commit),
      steps: REQUIRED_GATE_STEPS.map((command) => ({ command, result: "passed" as const, digest: releaseGateStepDigest(command, commit) })),
    },
  };
}

if (import.meta.main) {
  const repoRoot = resolve(import.meta.dir, "../..");
  if (run(["git", "status", "--porcelain"]).trim()) throw new Error("Release descriptor failed: commit or explicitly identify a clean worktree first");
  const commit = run(["git", "rev-parse", "HEAD"]).trim();
  run(["bun", "run", "release:verify"]);
  if (run(["git", "rev-parse", "HEAD"]).trim() !== commit || run(["git", "status", "--porcelain"]).trim()) {
    throw new Error("Release descriptor failed: release gate changed the checked-out revision or worktree");
  }
  const outputDirectory = resolve(repoRoot, Bun.env.RELEASE_DESCRIPTOR_DIR?.trim() || "release-artifacts");
  mkdirSync(outputDirectory, { recursive: true });
  const outputPath = resolve(outputDirectory, `${commit}.json`);
  writeFileSync(outputPath, `${JSON.stringify(createDescriptor(repoRoot, commit), null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  console.info(`Release descriptor created: ${outputPath}`);
}
