import { describe, expect, test } from "bun:test";
import { evaluateWindow } from "../src/lib/alerts";

describe("evaluateWindow", () => {
  test("тихое окно без ошибок — без алертов", () => {
    expect(evaluateWindow({ total: 500, serverErrors: 0, dbConnectionErrors: 0 })).toEqual([]);
  });

  test("любая ошибка подключения к БД — алерт независимо от объёма трафика", () => {
    const alerts = evaluateWindow({ total: 500, serverErrors: 1, dbConnectionErrors: 2 });
    expect(alerts.map((a) => a.key)).toContain("db-conn-errors");
  });

  test("доля 5xx выше 1% при достаточной выборке — алерт", () => {
    const alerts = evaluateWindow({ total: 100, serverErrors: 2, dbConnectionErrors: 0 });
    expect(alerts.map((a) => a.key)).toEqual(["5xx-rate"]);
  });

  test("доля 5xx выше 1%, но выборка мала и абсолютных ошибок мало — без алерта", () => {
    expect(evaluateWindow({ total: 5, serverErrors: 1, dbConnectionErrors: 0 })).toEqual([]);
  });

  test("выборка мала, но абсолютных ошибок достаточно — алерт по абсолютному порогу", () => {
    const alerts = evaluateWindow({ total: 5, serverErrors: 3, dbConnectionErrors: 0 });
    expect(alerts.map((a) => a.key)).toEqual(["5xx-rate"]);
  });

  test("оба условия одновременно — оба алерта", () => {
    const alerts = evaluateWindow({ total: 100, serverErrors: 5, dbConnectionErrors: 1 });
    expect(alerts.map((a) => a.key).sort()).toEqual(["5xx-rate", "db-conn-errors"]);
  });
});
