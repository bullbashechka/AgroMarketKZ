import { disposePreflight, preflightSupabaseMigration } from "./preflightSupabaseMigration";

const version = Bun.env.MIGRATION_EXPECT_VERSION;
if (!version || Bun.env.MIGRATION_CONFIRM !== `APPLY:${version}`) {
  throw new Error("Apply requires MIGRATION_CONFIRM=APPLY:<MIGRATION_EXPECT_VERSION> after a green preflight");
}

const context = preflightSupabaseMigration();
try {
  const result = Bun.spawnSync(["supabase", "--workdir", context.workdir, "db", "push", "--linked"], { stdout: "inherit", stderr: "inherit" });
  if (result.exitCode !== 0) throw new Error(`supabase db push exited with ${result.exitCode}`);
} finally {
  disposePreflight(context);
}
