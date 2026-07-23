import { describe, expect, test } from "bun:test";
import postgres, { type Sql } from "postgres";
import { HttpError } from "../src/lib/errors";
import { POSTGRES_POOL_OPTIONS, isConnectionError, withReconnect, type ClientHooks } from "../src/db";

describe("POSTGRES_POOL_OPTIONS", () => {
  test("задаёт безопасные параметры пула без переопределения max_lifetime", () => {
    expect(POSTGRES_POOL_OPTIONS).toEqual({
      max: 3,
      idle_timeout: 20,
      connect_timeout: 10,
      prepare: false,
    });
    expect(
      Object.prototype.hasOwnProperty.call(
        POSTGRES_POOL_OPTIONS,
        "max_lifetime",
      ),
    ).toBe(false);
  });
});

describe("isConnectionError", () => {
  test("ошибки бизнес-логики (HttpError) не ретраятся", () => {
    expect(isConnectionError(new HttpError(409, "уже использовано"))).toBe(false);
  });

  test("ошибки самого запроса (PostgresError, напр. constraint violation) не ретраятся", () => {
    const pgError = new postgres.PostgresError({
      message: "duplicate key value violates unique constraint",
      code: "23505",
    } as never);
    expect(isConnectionError(pgError)).toBe(false);
  });

  test("любая другая ошибка (обрыв сокета и т.п.) считается сетевой и ретраится", () => {
    expect(isConnectionError(new Error("read ECONNRESET"))).toBe(true);
    expect(isConnectionError(Object.assign(new Error("closed"), { code: "CONNECTION_CLOSED" }))).toBe(
      true,
    );
  });
});

/** Фейковый клиент postgres.js: callable-функция (tagged template) + `.begin`/`.end`. */
function makeFakeClient(queryOutcomes: Array<"ok" | "fail">, beginOutcomes: Array<"ok" | "fail"> = []) {
  let queryCalls = 0;
  let beginCalls = 0;
  let ended = false;
  const target = ((..._args: unknown[]) => {
    const outcome = queryOutcomes[queryCalls] ?? "ok";
    queryCalls++;
    return outcome === "fail" ? Promise.reject(new Error("read ECONNRESET")) : Promise.resolve("ok");
  }) as unknown as Sql;
  Object.assign(target, {
    begin: async (cb: (tx: Sql) => unknown) => {
      const outcome = beginOutcomes[beginCalls] ?? "ok";
      beginCalls++;
      if (outcome === "fail") throw new Error("read ECONNRESET");
      return cb(target);
    },
    end: async () => {
      ended = true;
    }
  });
  return {
    target,
    queryCalls: () => queryCalls,
    beginCalls: () => beginCalls,
    isEnded: () => ended
  };
}

function makeHooks(initial: Sql, create: () => Sql): ClientHooks {
  let current = initial;
  return {
    get: () => current,
    set: (next) => {
      current = next;
    },
    create
  };
}

function tag(sql: Sql) {
  return sql as unknown as (strings: TemplateStringsArray) => Promise<unknown>;
}

describe("withReconnect", () => {
  test("одиночный запрос ретраится один раз на новом клиенте при обрыве соединения", async () => {
    const first = makeFakeClient(["fail"]);
    const second = makeFakeClient(["ok"]);
    const hooks = makeHooks(first.target, () => second.target);

    const result = await tag(withReconnect(hooks))`select 1`;

    expect(result).toBe("ok");
    expect(first.queryCalls()).toBe(1);
    expect(second.queryCalls()).toBe(1);
    expect(first.isEnded()).toBe(true);
  });

  test("транзакция НЕ ретраится при обрыве, но клиент чинится для следующего getDb()", async () => {
    const first = makeFakeClient([], ["fail"]);
    const second = makeFakeClient(["ok"]);
    const hooks = makeHooks(first.target, () => second.target);

    await expect(withReconnect(hooks).begin(async () => "не должно выполниться")).rejects.toThrow(
      "read ECONNRESET",
    );
    expect(first.beginCalls()).toBe(1);
    expect(hooks.get()).toBe(second.target);

    // Следующий репозиторный вызов получает новый Proxy поверх уже починенного клиента
    // (как в реальном коде — `getDb(env)` вызывается заново на каждый repo-вызов).
    const nextResult = await tag(withReconnect(hooks))`select 1`;
    expect(nextResult).toBe("ok");
  });

  test("конкурентные обрывы координируются одним реконнектом с одним end() на старом клиенте", async () => {
    const first = makeFakeClient(["fail", "fail"]);
    const second = makeFakeClient(["ok", "ok"]);
    let factoryCalls = 0;
    const hooks = makeHooks(first.target, () => {
      factoryCalls++;
      return second.target;
    });
    const sql = tag(withReconnect(hooks));

    const [a, b] = await Promise.all([sql`select 1`, sql`select 1`]);

    expect(a).toBe("ok");
    expect(b).toBe("ok");
    expect(factoryCalls).toBe(1);
  });
});
