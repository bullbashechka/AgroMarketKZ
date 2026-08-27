import { describe, expect, test } from "bun:test";
import { createApp } from "../src/app";
import { metricRoute, writeMetric } from "../src/lib/metrics";

describe("bounded observability metrics", () => {
  test("uses the registered route template and a fixed unmatched label", () => {
    expect(metricRoute("/catalog/cards/:id")).toBe("/catalog/cards/:id");
    expect(metricRoute("")).toBe("unmatched");
  });

  test("records bounded dimensions and non-negative timing without a raw path", () => {
    const points: unknown[] = [];
    writeMetric({ REQUEST_METRICS: { writeDataPoint: (point: unknown) => points.push(point) } as AnalyticsEngineDataset }, {
      kind: "http",
      operation: "/catalog/cards/:id",
      outcome: "ok",
      category: "ok",
      durationMs: -4.4,
    });
    expect(points).toEqual([{
      indexes: ["ok"],
      blobs: ["http", "/catalog/cards/:id", "ok"],
      doubles: [0, 0],
    }]);
  });

  test("records a matched HTTP template instead of the client path", async () => {
    const points: unknown[] = [];
    const app = createApp({
      env: {
        WEBAPP_ORIGIN: "https://app.example",
        REQUEST_METRICS: { writeDataPoint: (point: unknown) => points.push(point) } as AnalyticsEngineDataset,
      },
      createDatabaseInvocation: () => ({}) as never,
    });
    const response = await app.request("/health?cardId=secret-value");
    expect(response.status).toBe(200);
    expect(points).toHaveLength(1);
    expect(points[0]).toMatchObject({
      indexes: ["ok"],
      blobs: ["http", "/health", "ok"],
    });
  });

  test("records a nested route leaf and keeps unmatched paths bounded", async () => {
    const points: unknown[] = [];
    const app = createApp({
      env: {
        WEBAPP_ORIGIN: "https://app.example",
        REQUEST_METRICS: { writeDataPoint: (point: unknown) => points.push(point) } as AnalyticsEngineDataset,
      },
      createDatabaseInvocation: () => ({}) as never,
    });
    expect((await app.request("/catalog/categories")).status).toBe(401);
    expect(points[0]).toMatchObject({ blobs: ["http", "/catalog/categories", "client_error"] });
    points.length = 0;
    expect((await app.request("/auth/not-a-route")).status).toBe(404);
    expect(points[0]).toMatchObject({ blobs: ["http", "unmatched", "client_error"] });
  });

  test("keeps the request successful when the telemetry binding throws", async () => {
    const app = createApp({
      env: {
        WEBAPP_ORIGIN: "https://app.example",
        REQUEST_METRICS: { writeDataPoint: () => { throw new Error("telemetry unavailable"); } } as AnalyticsEngineDataset,
      },
      createDatabaseInvocation: () => ({}) as never,
    });
    expect((await app.request("/health")).status).toBe(200);
  });
});
