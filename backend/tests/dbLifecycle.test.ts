import { describe, expect, test } from "bun:test";
import type { Sql } from "postgres";
import { createApp } from "../src/app";
import type { AppEnv } from "../src/env";
import type { DatabaseInvocation } from "../src/db";
import { runInBackground } from "../src/lib/background";

const env = {
  WEBAPP_ORIGIN: "http://localhost:5173",
  TELEGRAM_BOT_TOKEN: "test-token",
  ADMIN_ALLOWLIST: "",
} as AppEnv;

function fakeInvocation(onDispose: () => void): DatabaseInvocation {
  const sql = (() => Promise.resolve([])) as unknown as Sql;
  return {
    sql,
    retryIdempotentStandalone: async () => [],
    dispose: async () => onDispose(),
  };
}

describe("database invocation lifecycle", () => {
  test("каждый HTTP request получает и закрывает свой scope", async () => {
    let created = 0;
    let disposed = 0;
    const app = createApp({
      env,
      disposeDatabase: true,
      createDatabaseInvocation: () => {
        created++;
        return fakeInvocation(() => disposed++);
      },
    });

    await app.request("/health");
    await app.request("/health");

    expect(created).toBe(2);
    expect(disposed).toBe(2);
  });

  test("локальный lifecycle ждёт background DB work до dispose", async () => {
    const events: string[] = [];
    const app = createApp({
      env,
      disposeDatabase: true,
      createDatabaseInvocation: () => fakeInvocation(() => events.push("dispose")),
    });
    app.get("/__test/background", (c) => {
      const task = Promise.resolve().then(() => {
        events.push("task");
      });
      runInBackground(c, task);
      return c.body(null, 204);
    });

    const response = await app.request("/__test/background");
    expect(response.status).toBe(204);
    expect(events).toEqual(["task", "dispose"]);
  });
});
