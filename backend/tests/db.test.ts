import { describe, expect, test } from "bun:test";
import postgres from "postgres";
import { HttpError } from "../src/lib/errors";
import { POSTGRES_POOL_OPTIONS, isConnectionError } from "../src/db";

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
