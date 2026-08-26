import { describe, expect, test } from "bun:test";
import postgres, { type Sql } from "postgres";
import {
  POSTGRES_POOL_OPTIONS,
  createDatabaseInvocation,
  isConnectionError,
} from "../src/db";
import { HttpError } from "../src/lib/errors";

function cloudflareSocketWriteError(): Error {
  const error = new Error("");
  error.stack = [
    "Error",
    "    at EventEmitter.write (worker.js:18124:16)",
    "    at nextWrite (worker.js:19003:22)",
    "    at cachedError (worker.js:18314:23)",
    "    at new Query (worker.js:18208:75)",
  ].join("\n");
  return error;
}

describe("POSTGRES_POOL_OPTIONS", () => {
  test("держит один логический client на invocation и не переопределяет max_lifetime", () => {
    expect(POSTGRES_POOL_OPTIONS).toEqual({
      max: 1,
      idle_timeout: 20,
      connect_timeout: 10,
      prepare: false,
    });
    expect(Object.prototype.hasOwnProperty.call(POSTGRES_POOL_OPTIONS, "max_lifetime")).toBe(false);
  });
});

describe("isConnectionError", () => {
  test("ошибки бизнес-логики (HttpError) не ретраятся", () => {
    expect(isConnectionError(new HttpError(409, "уже использовано"))).toBe(false);
  });

  test("ошибки самого запроса (PostgresError, например constraint violation) не ретраятся", () => {
    const pgError = new postgres.PostgresError({
      message: "duplicate key value violates unique constraint",
      code: "23505",
    } as never);
    expect(isConnectionError(pgError)).toBe(false);
  });

  test("известные сетевые коды считаются сетевыми, а произвольный Error — нет", () => {
    expect(isConnectionError(Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" }))).toBe(true);
    expect(isConnectionError(Object.assign(new Error("closed"), { code: "CONNECTION_CLOSED" }))).toBe(true);
    expect(isConnectionError(new Error("ошибка приложения"))).toBe(false);
  });

  test("ошибка записи в закрытый Cloudflare postgres.js socket распознаётся без error.code", () => {
    expect(isConnectionError(cloudflareSocketWriteError())).toBe(true);

    const unrelated = new Error("ошибка приложения");
    unrelated.stack = "Error: ошибка приложения\n    at nextWrite (app.ts:10:2)";
    expect(isConnectionError(unrelated)).toBe(false);
  });
});

type QueryOutcome = "ok" | "fail" | "cloudflare-write-fail";
type BeginOutcome = QueryOutcome | "cloudflare-write-fail-after-callback";

function makeFakeClient(
  queryOutcomes: QueryOutcome[],
  beginOutcomes: BeginOutcome[] = [],
) {
  let queryCalls = 0;
  let beginCalls = 0;
  let ended = false;
  const target = ((..._args: unknown[]) => {
    const outcome = queryOutcomes[queryCalls] ?? "ok";
    queryCalls++;
    if (outcome === "fail") {
      return Promise.reject(Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" }));
    }
    if (outcome === "cloudflare-write-fail") {
      return Promise.reject(cloudflareSocketWriteError());
    }
    return Promise.resolve("ok");
  }) as unknown as Sql;
  Object.assign(target, {
    begin: async (cb: (tx: Sql) => unknown) => {
      const outcome = beginOutcomes[beginCalls] ?? "ok";
      beginCalls++;
      if (outcome === "fail") {
        throw Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" });
      }
      if (outcome === "cloudflare-write-fail") {
        throw cloudflareSocketWriteError();
      }
      if (outcome === "cloudflare-write-fail-after-callback") {
        await cb(target);
        throw cloudflareSocketWriteError();
      }
      return cb(target);
    },
    end: async () => {
      ended = true;
    },
  });
  return {
    target,
    queryCalls: () => queryCalls,
    beginCalls: () => beginCalls,
    isEnded: () => ended,
  };
}

function tag(sql: Sql) {
  return sql as unknown as (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>;
}

describe("createDatabaseInvocation", () => {
  test("обычный standalone write не ретраится после обрыва, но следующий запрос получает новый client", async () => {
    const first = makeFakeClient(["fail"]);
    const second = makeFakeClient(["ok"]);
    const clients = [first.target, second.target];
    let factoryCalls = 0;
    const db = createDatabaseInvocation({}, {
      createClient: () => clients[factoryCalls++]!,
    });

    await expect(tag(db.sql)`insert into audit_log default values`).rejects.toThrow("read ECONNRESET");
    expect(first.queryCalls()).toBe(1);
    expect(second.queryCalls()).toBe(0);
    expect(factoryCalls).toBe(2);

    await expect(tag(db.sql)`select 1`).resolves.toBe("ok");
    await db.dispose();
    expect(first.isEnded()).toBe(true);
    expect(second.isEnded()).toBe(true);
  });

  test("явно идемпотентный tagged-template запрос ретраится ровно один раз", async () => {
    const first = makeFakeClient(["cloudflare-write-fail"]);
    const second = makeFakeClient(["ok"]);
    let factoryCalls = 0;
    const db = createDatabaseInvocation({}, {
      createClient: () => [first.target, second.target][factoryCalls++]!,
    });

    await expect(db.retryIdempotentStandalone`select 1`).resolves.toBe("ok");
    expect(first.queryCalls()).toBe(1);
    expect(second.queryCalls()).toBe(1);
    expect(factoryCalls).toBe(2);
    await db.dispose();
  });

  test("транзакция чинит client, но никогда не повторяет callback", async () => {
    const first = makeFakeClient([], ["cloudflare-write-fail-after-callback"]);
    const second = makeFakeClient(["ok"]);
    let factoryCalls = 0;
    const db = createDatabaseInvocation({}, {
      createClient: () => [first.target, second.target][factoryCalls++]!,
    });
    let callbackCalls = 0;

    await expect(db.sql.begin(async () => {
      callbackCalls++;
      return "не должно выполниться";
    })).rejects.toBeDefined();

    expect(first.beginCalls()).toBe(1);
    expect(callbackCalls).toBe(1);
    expect(second.beginCalls()).toBe(0);
    expect(factoryCalls).toBe(2);
    await db.dispose();
  });

  test("два invocation не разделяют client instance", async () => {
    const first = makeFakeClient(["ok"]);
    const second = makeFakeClient(["ok"]);
    const invocationA = createDatabaseInvocation({}, { createClient: () => first.target });
    const invocationB = createDatabaseInvocation({}, { createClient: () => second.target });

    await expect(tag(invocationA.sql)`select 1`).resolves.toBe("ok");
    await expect(tag(invocationB.sql)`select 1`).resolves.toBe("ok");
    expect(first.queryCalls()).toBe(1);
    expect(second.queryCalls()).toBe(1);
    await Promise.all([invocationA.dispose(), invocationB.dispose()]);
  });

  test("конкурентные запросы используют не более одного replacement client", async () => {
    const first = makeFakeClient(["fail", "fail"]);
    const second = makeFakeClient(["ok", "ok"]);
    let factoryCalls = 0;
    const db = createDatabaseInvocation({}, {
      createClient: () => [first.target, second.target][factoryCalls++]!,
    });
    const sql = tag(db.sql);

    const results = await Promise.allSettled([sql`select 1`, sql`select 1`]);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(2);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(0);
    expect(factoryCalls).toBe(2);
    await db.dispose();
  });

  test("поздний отказ старого client не создаёт второй replacement", async () => {
    let queryCalls = 0;
    let rejectLateQuery!: (error: Error) => void;
    const firstTarget = ((..._args: unknown[]) => {
      queryCalls++;
      if (queryCalls === 1) {
        return Promise.reject(Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" }));
      }
      return new Promise((_resolve, reject) => {
        rejectLateQuery = reject;
      });
    }) as unknown as Sql;
    Object.assign(firstTarget, { end: async () => undefined });
    const second = makeFakeClient(["ok"]);
    let factoryCalls = 0;
    const db = createDatabaseInvocation({}, {
      createClient: () => [firstTarget, second.target][factoryCalls++]!,
    });
    const sql = tag(db.sql);

    const firstRequest = sql`select 1`;
    const lateRequest = sql`select 2`;
    await expect(firstRequest).rejects.toThrow("read ECONNRESET");
    expect(factoryCalls).toBe(2);

    rejectLateQuery(Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" }));
    await expect(lateRequest).rejects.toThrow("read ECONNRESET");
    expect(factoryCalls).toBe(2);
    await db.dispose();
  });
});
