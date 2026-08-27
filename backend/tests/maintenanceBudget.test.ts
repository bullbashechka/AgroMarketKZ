import { describe, expect, test } from "bun:test";
import {
  hasMaintenanceBudget,
  MAINTENANCE_JOB_BUDGET_MS,
  MAINTENANCE_RESERVE_MS,
} from "../src/lib/maintenanceBudget";

describe("maintenance job budget", () => {
  test("does not start a new I/O unit inside the reserved execution window", () => {
    const startedAt = 1_000;

    expect(hasMaintenanceBudget(startedAt, startedAt + MAINTENANCE_JOB_BUDGET_MS - MAINTENANCE_RESERVE_MS - 1)).toBeTrue();
    expect(hasMaintenanceBudget(startedAt, startedAt + MAINTENANCE_JOB_BUDGET_MS - MAINTENANCE_RESERVE_MS)).toBeFalse();
  });
});
