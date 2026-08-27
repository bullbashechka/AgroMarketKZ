export const MAINTENANCE_JOB_BUDGET_MS = 20_000;
export const MAINTENANCE_RESERVE_MS = 1_000;

/** Do not begin another external call or destructive batch near the Worker budget. */
export function hasMaintenanceBudget(startedAt: number, now = Date.now()): boolean {
  return now - startedAt < MAINTENANCE_JOB_BUDGET_MS - MAINTENANCE_RESERVE_MS;
}
