import type { AppEnv } from "../env";

/** Bounded Analytics Engine dimensions. Never pass client-controlled paths or ids. */
export type MetricKind = "http" | "db" | "telegram" | "storage" | "queue" | "cron";
export type MetricOutcome = "ok" | "client_error" | "server_error" | "error" | "retry";

export interface MetricPoint {
  kind: MetricKind;
  operation: string;
  outcome: MetricOutcome;
  durationMs: number;
  category?: "ok" | "client_error" | "server_error" | "db_conn_error";
  quantity?: number;
}

export function metricNow(): number {
  return performance.now();
}

/** Analytics failure is intentionally fail-open and cannot affect the caller. */
export function writeMetric(env: Pick<AppEnv, "REQUEST_METRICS">, point: MetricPoint): void {
  try {
    env.REQUEST_METRICS?.writeDataPoint({
      indexes: [point.category ?? `${point.kind}_${point.outcome}`],
      blobs: [point.kind, point.operation, point.outcome],
      doubles: [Math.max(0, Math.round(point.durationMs)), Math.max(0, point.quantity ?? 0)],
    });
  } catch {
    // Telemetry must not change HTTP, queue, cron, or recovery outcomes.
  }
}

/** A 404 has no registered Hono route; do not turn arbitrary user paths into labels. */
export function metricRoute(routeTemplate: string): string {
  return routeTemplate === "" || routeTemplate.includes("*") ? "unmatched" : routeTemplate;
}
