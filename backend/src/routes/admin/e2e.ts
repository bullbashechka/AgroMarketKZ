import { Hono } from "hono";
import type { HonoEnv } from "../../env";
import { cleanupE2eRun } from "../../repos/e2eCleanup";
import { getEnv } from "../../env";

export const adminE2eRoutes = new Hono<HonoEnv>();

/** Test-only cleanup. The repository refuses to run unless the backend has E2E_RUN_ID. */
adminE2eRoutes.post("/cleanup", async (c) => {
  await cleanupE2eRun(getEnv(c));
  return c.json({ ok: true });
});
