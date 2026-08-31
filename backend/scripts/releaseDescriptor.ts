import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export const RELEASE_DESCRIPTOR_VERSION = 1;
export const REQUIRED_GATE_STEPS = [
  "bun install --frozen-lockfile",
  "bun run types:worker:check",
  "bun run quality:check",
  "bun run test:e2e",
] as const;

export type ReleaseDescriptor = {
  version: typeof RELEASE_DESCRIPTOR_VERSION;
  commit: string;
  createdAt: string;
  changeKind: "code" | "configuration";
  migration: { projectRef: string; version: string; checksum: string; expectedLedger: string[] };
  proxyProtocolVersion: string;
  resources: {
    accountId: string;
    workerName: string;
    pagesProjectName: string;
    hyperdriveId: string;
    queueNames: string[];
  };
  gates: {
    command: "bun run release:verify";
    result: "passed";
    digest: string;
    steps: Array<{ command: string; result: "passed"; digest: string }>;
  };
};

export type ReleasePreflightSnapshot = {
  commit: string;
  accountId: string;
  workerName: string;
  pagesProjectName: string;
  pagesCommit: string;
  activeVersionId: string;
  bindingValues: string[];
  appliedMigrationVersions: string[];
  projectRef: string;
  migrationChecksum: string;
  proxyProtocolVersion: string;
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Release preflight failed: ${message}`);
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function isSha(value: unknown, length: number): value is string {
  return typeof value === "string" && new RegExp(`^[a-f0-9]{${length}}$`).test(value);
}

export function parseReleaseDescriptor(source: string): ReleaseDescriptor {
  const descriptor = JSON.parse(source) as Partial<ReleaseDescriptor>;
  assert(descriptor.version === RELEASE_DESCRIPTOR_VERSION, "unsupported descriptor version");
  assert(isSha(descriptor.commit, 40), "descriptor commit must be a 40-character SHA");
  assert(typeof descriptor.createdAt === "string" && Number.isFinite(Date.parse(descriptor.createdAt)), "descriptor createdAt is invalid");
  assert(descriptor.changeKind === "code" || descriptor.changeKind === "configuration", "descriptor changeKind is invalid");
  assert(typeof descriptor.migration?.projectRef === "string" && /^[a-z0-9]{20}$/.test(descriptor.migration.projectRef), "descriptor migration project is invalid");
  assert(typeof descriptor.migration?.version === "string" && /^\d{14}$/.test(descriptor.migration.version), "descriptor migration version is invalid");
  assert(isSha(descriptor.migration?.checksum, 64), "descriptor migration checksum is invalid");
  assert(Array.isArray(descriptor.migration?.expectedLedger) && descriptor.migration.expectedLedger.every((value) => /^\d{14}$/.test(value)), "descriptor expected ledger is invalid");
  assert(typeof descriptor.proxyProtocolVersion === "string" && /^\d+$/.test(descriptor.proxyProtocolVersion), "descriptor proxy protocol is invalid");
  assert(typeof descriptor.resources?.accountId === "string" && /^[a-f0-9]{32}$/.test(descriptor.resources.accountId), "descriptor account id is invalid");
  assert(typeof descriptor.resources?.workerName === "string" && descriptor.resources.workerName.length > 0, "descriptor worker name is invalid");
  assert(typeof descriptor.resources?.pagesProjectName === "string" && descriptor.resources.pagesProjectName.length > 0, "descriptor Pages project is invalid");
  assert(typeof descriptor.resources?.hyperdriveId === "string" && /^[a-f0-9]{32}$/.test(descriptor.resources.hyperdriveId), "descriptor Hyperdrive id is invalid");
  assert(Array.isArray(descriptor.resources?.queueNames) && descriptor.resources.queueNames.length > 0 && descriptor.resources.queueNames.every((value) => typeof value === "string" && value.length > 0), "descriptor queue identities are invalid");
  assert(descriptor.gates?.command === "bun run release:verify" && descriptor.gates?.result === "passed" && isSha(descriptor.gates?.digest, 64)
    && Array.isArray(descriptor.gates.steps) && descriptor.gates.steps.length > 0
    && descriptor.gates.steps.every((step) => typeof step.command === "string" && step.command.length > 0 && step.result === "passed" && isSha(step.digest, 64)), "descriptor does not prove the required release gate");
  return descriptor as ReleaseDescriptor;
}

export function loadReleaseDescriptor(path: string): ReleaseDescriptor {
  return parseReleaseDescriptor(readFileSync(path, "utf8"));
}

/** A deterministic, secret-free digest of the gate command and its successful source revision. */
export function releaseGateDigest(commit: string): string {
  return sha256(`${REQUIRED_GATE_STEPS.join("\n")}\npassed\n${commit}\n`);
}

export function releaseGateStepDigest(command: string, commit: string): string {
  return sha256(`${command}\npassed\n${commit}\n`);
}

export function assertReleasePreflight(descriptor: ReleaseDescriptor, snapshot: ReleasePreflightSnapshot): void {
  assert(descriptor.gates.steps.length === REQUIRED_GATE_STEPS.length
    && descriptor.gates.steps.every((step, index) => step.command === REQUIRED_GATE_STEPS[index])
    && descriptor.gates.result === "passed" && descriptor.gates.digest === releaseGateDigest(descriptor.commit)
    && descriptor.gates.steps.every((step) => step.result === "passed" && step.digest === releaseGateStepDigest(step.command, descriptor.commit)), "descriptor gate result is missing or tampered");
  assert(snapshot.commit === descriptor.commit, `descriptor commit ${descriptor.commit} is stale for checked-out ${snapshot.commit}`);
  assert(snapshot.accountId === descriptor.resources.accountId, "Cloudflare account does not match descriptor");
  assert(snapshot.workerName === descriptor.resources.workerName, "Worker name does not match descriptor");
  assert(snapshot.pagesProjectName === descriptor.resources.pagesProjectName, "Pages project does not match descriptor");
  assert(snapshot.pagesCommit === descriptor.commit, "Pages production commit does not match descriptor");
  assert(typeof snapshot.activeVersionId === "string" && snapshot.activeVersionId.length > 0, "active Worker version was not resolved");
  const expectedBindings = [descriptor.resources.hyperdriveId, ...descriptor.resources.queueNames];
  const missingBindings = expectedBindings.filter((value) => !snapshot.bindingValues.includes(value));
  assert(missingBindings.length === 0, `active Worker bindings differ: ${missingBindings.join(", ")}`);
  assert(snapshot.projectRef === descriptor.migration.projectRef, "linked Supabase project does not match descriptor");
  assert(snapshot.appliedMigrationVersions.length === descriptor.migration.expectedLedger.length && snapshot.appliedMigrationVersions.every((version, index) => version === descriptor.migration.expectedLedger[index]), "remote migration ledger differs from descriptor");
  assert(snapshot.migrationChecksum === descriptor.migration.checksum, "migration checksum does not match descriptor");
  assert(snapshot.proxyProtocolVersion === descriptor.proxyProtocolVersion, "Pages-to-Worker proxy protocol does not match descriptor");
}
