import { expect, test } from "bun:test";
import {
  assertReleasePreflight,
  parseReleaseDescriptor,
  REQUIRED_GATE_STEPS,
  releaseGateDigest,
  releaseGateStepDigest,
  type ReleaseDescriptor,
  type ReleasePreflightSnapshot,
} from "../scripts/releaseDescriptor";

const commit = "a".repeat(40);
const descriptor: ReleaseDescriptor = {
  version: 1,
  commit,
  createdAt: "2026-08-31T08:00:00.000Z",
  changeKind: "code",
  migration: { projectRef: "qxyieyzfdcosmmckyocm", version: "20260827000000", checksum: "b".repeat(64), expectedLedger: ["20260826080000", "20260827000000"] },
  proxyProtocolVersion: "1",
  resources: {
    accountId: "c".repeat(32),
    workerName: "agromarketkz-backend",
    pagesProjectName: "agromarketkz-webapp",
    hyperdriveId: "d".repeat(32),
    queueNames: ["agromarketkz-notifications-prod", "agromarketkz-telegram-updates-prod"],
  },
  gates: {
    command: "bun run release:verify",
    result: "passed",
    digest: releaseGateDigest(commit),
    steps: REQUIRED_GATE_STEPS.map((command) => ({ command, result: "passed" as const, digest: releaseGateStepDigest(command, commit) })),
  },
};

function snapshot(overrides: Partial<ReleasePreflightSnapshot> = {}): ReleasePreflightSnapshot {
  return {
    commit,
    accountId: descriptor.resources.accountId,
    workerName: descriptor.resources.workerName,
    pagesProjectName: descriptor.resources.pagesProjectName,
    pagesCommit: descriptor.commit,
    activeVersionId: "active-version",
    bindingValues: [descriptor.resources.hyperdriveId, ...descriptor.resources.queueNames],
    appliedMigrationVersions: ["20260826080000", descriptor.migration.version],
    projectRef: descriptor.migration.projectRef,
    migrationChecksum: descriptor.migration.checksum,
    proxyProtocolVersion: descriptor.proxyProtocolVersion,
    ...overrides,
  };
}

test("release descriptor accepts an identified compatible release", () => {
  expect(parseReleaseDescriptor(JSON.stringify(descriptor))).toEqual(descriptor);
  expect(() => assertReleasePreflight(descriptor, snapshot())).not.toThrow();
});

test("release descriptor rejects a tampered or missing gate result", () => {
  expect(() => parseReleaseDescriptor(JSON.stringify({ ...descriptor, gates: { ...descriptor.gates, digest: "e".repeat(64) } }))).not.toThrow();
  expect(() => assertReleasePreflight({ ...descriptor, gates: { ...descriptor.gates, digest: "e".repeat(64) } }, snapshot())).toThrow(/gate result/i);
  expect(() => parseReleaseDescriptor(JSON.stringify({ ...descriptor, gates: { ...descriptor.gates, result: "failed" } }))).toThrow(/required release gate/i);
  expect(() => assertReleasePreflight({ ...descriptor, gates: { ...descriptor.gates, steps: descriptor.gates.steps.slice(1) } }, snapshot())).toThrow(/gate result/i);
});

test("release descriptor fails closed for stale commit, migration, protocol and resource identities", () => {
  expect(() => assertReleasePreflight(descriptor, snapshot({ commit: "f".repeat(40) }))).toThrow(/stale/i);
  expect(() => assertReleasePreflight(descriptor, snapshot({ appliedMigrationVersions: [] }))).toThrow(/migration/i);
  expect(() => assertReleasePreflight(descriptor, snapshot({ projectRef: "a".repeat(20) }))).toThrow(/Supabase project/i);
  expect(() => assertReleasePreflight(descriptor, snapshot({ pagesCommit: "f".repeat(40) }))).toThrow(/Pages production commit/i);
  expect(() => assertReleasePreflight(descriptor, snapshot({ migrationChecksum: "f".repeat(64) }))).toThrow(/checksum/i);
  expect(() => assertReleasePreflight(descriptor, snapshot({ bindingValues: descriptor.resources.queueNames }))).toThrow(/bindings/i);
  expect(() => parseReleaseDescriptor(JSON.stringify({ ...descriptor, proxyProtocolVersion: "unknown" }))).toThrow(/proxy protocol/i);
  expect(() => assertReleasePreflight(descriptor, snapshot({ proxyProtocolVersion: "2" }))).toThrow(/proxy protocol/i);
  expect(() => assertReleasePreflight(descriptor, snapshot({ accountId: "0".repeat(32) }))).toThrow(/account/i);
});
