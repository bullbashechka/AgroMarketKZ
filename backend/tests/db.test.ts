import { describe, expect, test } from "bun:test";
import { POSTGRES_POOL_OPTIONS } from "../src/db";

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
