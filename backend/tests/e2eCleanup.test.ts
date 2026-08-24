import { describe, expect, test } from "bun:test";
import { cleanupE2eRun, e2eLikePrefix } from "../src/repos/e2eCleanup";
import type { AppEnv } from "../src/env";

const env = { E2E_RUN_ID: undefined } as AppEnv;

describe("E2E cleanup guard", () => {
  test("refuses to run without an explicit run id", async () => {
    await expect(cleanupE2eRun(env)).rejects.toThrow("E2E cleanup is unavailable");
  });

  test("escapes underscore so neighboring run prefixes are not matched", () => {
    expect(e2eLikePrefix("run_under_score")).toBe("[e2e:run\\_under\\_score]%");
  });
});
