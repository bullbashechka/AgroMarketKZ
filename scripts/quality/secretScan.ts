import { copyFileSync, lstatSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const requiredGitleaksVersion = "8.30.1";
const repoRoot = resolve(import.meta.dir, "../..");
const configPath = join(repoRoot, ".gitleaks.toml");

function run(command: string[], cwd: string): ReturnType<typeof Bun.spawnSync> {
  return Bun.spawnSync(command, { cwd, stdout: "pipe", stderr: "pipe" });
}

function requireSuccess(command: string[], cwd: string, message: string): void {
  if (run(command, cwd).exitCode !== 0) throw new Error(message);
}

function requirePinnedGitleaks(): void {
  const version = run(["gitleaks", "version"], repoRoot);
  const actualVersion = version.stdout.toString().trim();
  if (version.exitCode !== 0 || actualVersion !== requiredGitleaksVersion) {
    throw new Error(`Gitleaks ${requiredGitleaksVersion} is required; found ${actualVersion || "not installed"}.`);
  }
}

function redactedOutput(result: ReturnType<typeof Bun.spawnSync>): string {
  return [result.stdout.toString().trim(), result.stderr.toString().trim()].filter(Boolean).join("\n");
}

function requireCleanScan(command: string[], label: string, cwd = repoRoot): void {
  const result = run(command, cwd);
  if (result.exitCode === 0) return;
  const output = redactedOutput(result);
  if (output) console.error(output);
  throw new Error(`Gitleaks detected a potential secret in ${label}. Rotate or revoke any live credential, then make a separate exception decision.`);
}

function changedPaths(): string[] {
  const commands = [
    ["git", "diff", "--name-only", "--diff-filter=ACMRTUXB", "HEAD", "--"],
    ["git", "ls-files", "--others", "--exclude-standard"],
  ];
  return [...new Set(commands.flatMap((command) => {
    const result = run(command, repoRoot);
    if (result.exitCode !== 0) throw new Error("Unable to list working-tree files for secret scanning.");
    return result.stdout.toString().split("\n").filter(Boolean);
  }))];
}

function verifyWorkingTreeChanges(): void {
  const candidateRoot = mkdtempSync(join(tmpdir(), "agromarket-quality-working-tree-"));
  try {
    copyFileSync(join(repoRoot, ".gitleaksignore"), join(candidateRoot, ".gitleaksignore"));
    for (const path of changedPaths()) {
      const source = resolve(repoRoot, path);
      if (!source.startsWith(`${repoRoot}/`) || !lstatSync(source).isFile()) continue;
      const target = join(candidateRoot, path);
      mkdirSync(dirname(target), { recursive: true });
      copyFileSync(source, target);
    }
    requireCleanScan(["gitleaks", "dir", "--redact=100", "--no-banner", "--config", configPath, candidateRoot], "staged or working-tree changes", candidateRoot);
  } finally {
    rmSync(candidateRoot, { recursive: true, force: true });
  }
}

function verifySecretProbe(): void {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "agromarket-quality-secret-"));
  try {
    requireSuccess(["git", "init", "--quiet"], fixtureRoot, "Unable to initialize the secret-scan fixture.");
    const fixtureSecret = ["AKIA", "7K9Q2W5E8R1T3Y6U"].join("");
    writeFileSync(join(fixtureRoot, "fixture.txt"), `token=${fixtureSecret}\n`);
    requireSuccess(["git", "add", "fixture.txt"], fixtureRoot, "Unable to stage the secret-scan fixture.");
    requireSuccess(
      ["git", "-c", "user.name=quality-gate", "-c", "user.email=quality-gate@example.invalid", "commit", "--quiet", "-m", "fixture"],
      fixtureRoot,
      "Unable to commit the secret-scan fixture."
    );
    const result = run(["gitleaks", "git", "--redact=100", "--no-banner", "--config", configPath, fixtureRoot], fixtureRoot);
    if (result.exitCode === 0) throw new Error("Secret-scan probe failed: an intentional test secret was not rejected.");
    const workingTreeResult = run(["gitleaks", "dir", "--redact=100", "--no-banner", "--config", configPath, fixtureRoot], fixtureRoot);
    if (workingTreeResult.exitCode === 0) throw new Error("Secret-scan probe failed: an intentional test secret was not rejected from the working tree.");
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
}

requirePinnedGitleaks();
verifySecretProbe();
requireCleanScan(["gitleaks", "git", "--redact=100", "--no-banner", "--config", configPath, repoRoot], "Git history");
verifyWorkingTreeChanges();
console.info(`Gitleaks ${requiredGitleaksVersion} passed redacted history and staged/working-tree scans.`);
