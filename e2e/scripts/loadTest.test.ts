import { describe, expect, test } from "bun:test";
import {
  LOAD_TEST_LIMITS,
  buildFeedbackPayload,
  buildReadJourney,
  buildRequestPayload,
  buildUser,
  classifyResponse,
  makeOversizedJson,
  parseLoadConfig,
  summarize,
  type LoadSample,
} from "./loadTest";

const RUN_ID = "123e4567-e89b-42d3-a456-426614174000";

function validEnv(overrides: Record<string, string | undefined> = {}) {
  return {
    LOAD_TEST_API_URL: "https://API.Example.com:443/",
    LOAD_TEST_ALLOW_TARGET: "https://api.example.com",
    LOAD_TEST_TELEGRAM_BOT_TOKEN: "test-bot-token",
    LOAD_TEST_USERS: "4",
    LOAD_TEST_CONCURRENCY: "2",
    LOAD_TEST_DURATION_SECONDS: "15",
    LOAD_TEST_RUN_ID: RUN_ID,
    ...overrides,
  };
}

describe("parseLoadConfig", () => {
  test("normalizes the exact API origin and parses strict defaults", () => {
    expect(parseLoadConfig(validEnv())).toEqual({
      apiOrigin: "https://api.example.com",
      botToken: "test-bot-token",
      users: 4,
      concurrency: 2,
      durationSeconds: 15,
      mutationsEnabled: false,
      rateLimitProbeEnabled: false,
      runId: RUN_ID,
    });
  });

  test("uses TELEGRAM_BOT_TOKEN only when the load-test token is absent", () => {
    const config = parseLoadConfig(
      validEnv({
        LOAD_TEST_TELEGRAM_BOT_TOKEN: undefined,
        TELEGRAM_BOT_TOKEN: "fallback-token",
      }),
    );

    expect(config.botToken).toBe("fallback-token");
  });

  test("rejects unsafe URL forms and a target that is not the normalized origin", () => {
    for (const apiUrl of [
      "ftp://api.example.com",
      "https://user:password@api.example.com",
      "https://api.example.com/v1",
      "https://api.example.com?mode=test",
      "https://api.example.com#fragment",
      "/relative",
    ]) {
      expect(() => parseLoadConfig(validEnv({ LOAD_TEST_API_URL: apiUrl }))).toThrow(
        "LOAD_TEST_API_URL",
      );
    }

    expect(() =>
      parseLoadConfig(validEnv({ LOAD_TEST_ALLOW_TARGET: "https://api.example.com/" })),
    ).toThrow("LOAD_TEST_ALLOW_TARGET");
  });

  test("requires positive bounded safe integers and concurrency no greater than users", () => {
    for (const [name, value] of [
      ["LOAD_TEST_USERS", "0"],
      ["LOAD_TEST_USERS", String(LOAD_TEST_LIMITS.maxUsers + 1)],
      ["LOAD_TEST_CONCURRENCY", "1.5"],
      ["LOAD_TEST_CONCURRENCY", String(LOAD_TEST_LIMITS.maxConcurrency + 1)],
      ["LOAD_TEST_DURATION_SECONDS", "-1"],
      ["LOAD_TEST_DURATION_SECONDS", String(LOAD_TEST_LIMITS.maxDurationSeconds + 1)],
    ] as const) {
      expect(() => parseLoadConfig(validEnv({ [name]: value }))).toThrow(name);
    }

    expect(() => parseLoadConfig(validEnv({ LOAD_TEST_CONCURRENCY: "5" }))).toThrow(
      "LOAD_TEST_CONCURRENCY",
    );
  });

  test("enforces both additional mutation guards", () => {
    expect(() =>
      parseLoadConfig(validEnv({ LOAD_TEST_ENABLE_MUTATIONS: "1" })),
    ).toThrow("LOAD_TEST_ALLOW_WRITE_TARGET");

    expect(() =>
      parseLoadConfig(
        validEnv({
          LOAD_TEST_ENABLE_MUTATIONS: "1",
          LOAD_TEST_ALLOW_WRITE_TARGET: "https://api.example.com",
        }),
      ),
    ).toThrow("LOAD_TEST_NOTIFICATIONS_DISABLED_CONFIRMED");

    const config = parseLoadConfig(
      validEnv({
        LOAD_TEST_ENABLE_MUTATIONS: "1",
        LOAD_TEST_ALLOW_WRITE_TARGET: "https://api.example.com",
        LOAD_TEST_NOTIFICATIONS_DISABLED_CONFIRMED: "1",
        LOAD_TEST_RATE_LIMIT_PROBE: "1",
      }),
    );

    expect(config.mutationsEnabled).toBe(true);
    expect(config.rateLimitProbeEnabled).toBe(true);
  });

  test("rejects non-binary opt-in values", () => {
    expect(() => parseLoadConfig(validEnv({ LOAD_TEST_ENABLE_MUTATIONS: "true" }))).toThrow(
      "LOAD_TEST_ENABLE_MUTATIONS",
    );
    expect(() => parseLoadConfig(validEnv({ LOAD_TEST_RATE_LIMIT_PROBE: "2" }))).toThrow(
      "LOAD_TEST_RATE_LIMIT_PROBE",
    );
  });

  test("derives a stable UUID run id when the CLI has not injected one", () => {
    const env = validEnv({ LOAD_TEST_RUN_ID: undefined });
    const first = parseLoadConfig(env).runId;
    const second = parseLoadConfig(env).runId;

    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(second).toBe(first);
  });
});

describe("load-test identities and payloads", () => {
  test("buildUser is deterministic and unique inside a dedicated safe-integer range", () => {
    const first = buildUser(0, RUN_ID);
    const repeated = buildUser(0, RUN_ID);
    const second = buildUser(1, RUN_ID);

    expect(repeated).toEqual(first);
    expect(second.id).not.toBe(first.id);
    expect(Number.isSafeInteger(first.id)).toBe(true);
    expect(first.id).toBeGreaterThanOrEqual(8_000_000_000_000_000);
    expect(first.id).toBeGreaterThan(0);
    expect(first.first_name).toBe("[load-test]");
    expect(first.last_name).toContain("user-0");
  });

  test("buildRequestPayload uses a stable UUID, profile source, marker, and reserved phone", () => {
    const payload = buildRequestPayload(RUN_ID, 7);

    expect(payload).toEqual(buildRequestPayload(RUN_ID, 7));
    expect(payload.clientRequestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(payload.clientRequestId).not.toBe(buildRequestPayload(RUN_ID, 8).clientRequestId);
    expect(payload.source).toBe("profile");
    expect(payload.contactPhone).toBe("+77000000000");
    expect(payload.contactName).toContain("[load-test]");
    expect(payload.comment).toContain("[load-test]");
  });

  test("buildFeedbackPayload contains only marked test contact data", () => {
    const payload = buildFeedbackPayload(RUN_ID, 7);

    expect(payload).toEqual({
      contactName: `[load-test] ${RUN_ID.slice(0, 8)} user 7`,
      contactPhone: "+77000000000",
      message: `[load-test] run=${RUN_ID} user=7`,
    });
  });
});

describe("buildReadJourney", () => {
  test("builds exact authenticated profile, categories, and cards requests", () => {
    const journey = buildReadJourney("jwt-token", "product");
    const headers = {
      accept: "application/json",
      authorization: "Bearer jwt-token",
    };

    expect(journey.requests).toEqual([
      {
        route: "/profile",
        method: "GET",
        path: "/profile",
        headers,
        expectedKind: "normal",
      },
      {
        route: "/catalog/categories",
        method: "GET",
        path: "/catalog/categories?type=product",
        headers,
        expectedKind: "normal",
      },
      {
        route: "/catalog/cards",
        method: "GET",
        path: "/catalog/cards?type=product&limit=1&offset=0",
        headers,
        expectedKind: "normal",
      },
    ]);
  });

  test("builds card detail only after parsing a non-empty list response", () => {
    const journey = buildReadJourney("jwt-token", "service");
    const id = "11111111-1111-4111-8111-111111111111";

    expect(journey.buildCardDetail({ items: [] })).toBeNull();
    expect(journey.buildCardDetail({ items: [{ id }] })).toEqual({
      route: "/catalog/cards/:id",
      method: "GET",
      path: `/catalog/cards/${id}`,
      headers: {
        accept: "application/json",
        authorization: "Bearer jwt-token",
      },
      expectedKind: "normal",
    });
    expect(() => journey.buildCardDetail({ cards: [] })).toThrow("catalog cards response");
  });
});

describe("probes and response classification", () => {
  test("makeOversizedJson returns valid JSON of exactly limit plus one UTF-8 bytes", () => {
    const limitBytes = 256 * 1024;
    const body = makeOversizedJson(limitBytes);

    expect(new TextEncoder().encode(body).byteLength).toBe(limitBytes + 1);
    expect(JSON.parse(body)).toBe(0);
  });

  test("classifyResponse distinguishes success, expected probes, 4xx, and 5xx", () => {
    const cases = [
      [200, "normal", "normal_success"],
      [204, "oversized_probe", "normal_success"],
      [413, "oversized_probe", "expected_413"],
      [413, "normal", "client_error"],
      [429, "rate_limit_probe", "expected_429"],
      [429, "normal", "client_error"],
      [400, "normal", "client_error"],
      [503, "normal", "server_error"],
    ] as const;

    for (const [status, expectedKind, classification] of cases) {
      expect(classifyResponse(status, expectedKind)).toBe(classification);
    }
  });

  test("classifies a blocked redirect separately and keeps it as a run failure", async () => {
    const classification = classifyResponse(302, "normal");
    expect(classification).toBe("redirect_error");

    const summary = summarize([
      {
        route: "/profile",
        durationMs: 5,
        status: 302,
        classification,
      },
    ]);
    expect(summary.clientErrors4xx).toBe(0);
    expect(Reflect.get(summary, "redirectErrors")).toBe(1);

    type FailureCheck = (
      value: typeof summary,
      oversizedProbePassed: boolean,
      rateProbe: { enabled: boolean; passed: boolean | null },
    ) => boolean;
    const module = await import("./loadTest");
    const candidate: unknown = Reflect.get(module, "hasRunFailure");
    expect(typeof candidate).toBe("function");
    const hasRunFailure = candidate as FailureCheck;
    expect(hasRunFailure(summary, true, { enabled: false, passed: null })).toBe(true);
  });

  test("rate probe schedules only one bounded batch and settles in-flight work after first 429", async () => {
    type ProbeDecision<Value> = { stop: boolean; value: Value };
    type ProbeBatchResult<Value> = {
      attempts: number;
      stopped: boolean;
      stopValue: Value | null;
      deadlineReached: boolean;
      operationFailed: boolean;
    };
    type ProbeBatchRunner = <Value>(
      options: {
        maxRequests: number;
        concurrency: number;
        deadlineAtMs: number;
        now?: () => number;
      },
      operation: (attempt: number, deadlineAtMs: number) => Promise<ProbeDecision<Value>>,
    ) => Promise<ProbeBatchResult<Value>>;

    const module = await import("./loadTest");
    const candidate: unknown = Reflect.get(module, "runBoundedProbeBatches");
    expect(typeof candidate).toBe("function");
    const runBoundedProbeBatches = candidate as ProbeBatchRunner;

    expect(Reflect.get(LOAD_TEST_LIMITS, "rateProbeConcurrency")).toBe(10);
    expect(Reflect.get(LOAD_TEST_LIMITS, "rateProbeDeadlineMs")).toBe(45_000);
    expect(Reflect.get(LOAD_TEST_LIMITS, "rateProbeDeadlineMs")).toBeLessThan(60_000);

    const scheduled: number[] = [];
    const resolvers = new Map<number, (decision: ProbeDecision<string>) => void>();
    const run = runBoundedProbeBatches<string>(
      {
        maxRequests: 200,
        concurrency: 3,
        deadlineAtMs: 45_000,
        now: () => 0,
      },
      (attempt) => {
        scheduled.push(attempt);
        return new Promise((resolve) => resolvers.set(attempt, resolve));
      },
    );
    let completed = false;
    void run.then(() => {
      completed = true;
    });

    expect(scheduled).toEqual([1, 2, 3]);
    resolvers.get(2)?.({ stop: true, value: "429" });
    await Promise.resolve();
    expect(completed).toBe(false);
    expect(scheduled).toEqual([1, 2, 3]);

    resolvers.get(1)?.({ stop: false, value: "200" });
    resolvers.get(3)?.({ stop: false, value: "200" });
    expect(await run).toEqual({
      attempts: 3,
      stopped: true,
      stopValue: "429",
      deadlineReached: false,
      operationFailed: false,
    });
    expect(scheduled).toEqual([1, 2, 3]);
  });

  test("rate probe does not schedule another batch after its absolute deadline", async () => {
    type ProbeBatchRunner = (
      options: {
        maxRequests: number;
        concurrency: number;
        deadlineAtMs: number;
        now?: () => number;
      },
      operation: (attempt: number, deadlineAtMs: number) => Promise<{ stop: boolean; value: number }>,
    ) => Promise<{ attempts: number; deadlineReached: boolean }>;

    const module = await import("./loadTest");
    const candidate: unknown = Reflect.get(module, "runBoundedProbeBatches");
    expect(typeof candidate).toBe("function");
    const runBoundedProbeBatches = candidate as ProbeBatchRunner;
    const scheduled: number[] = [];
    let now = 0;

    const result = await runBoundedProbeBatches(
      {
        maxRequests: 200,
        concurrency: 3,
        deadlineAtMs: 45_000,
        now: () => now,
      },
      async (attempt) => {
        scheduled.push(attempt);
        now = 45_000;
        return { stop: false, value: 200 };
      },
    );

    expect(scheduled).toEqual([1, 2, 3]);
    expect(result.attempts).toBe(3);
    expect(result.deadlineReached).toBe(true);
  });
});

describe("summarize", () => {
  test("computes totals and nearest-rank route percentiles without retaining bodies or tokens", () => {
    const samples: Array<LoadSample & { rawBody?: string; token?: string }> = [
      { route: "/profile", durationMs: 10, status: 200, classification: "normal_success" },
      { route: "/profile", durationMs: 20, status: 200, classification: "normal_success" },
      { route: "/profile", durationMs: 30, status: 429, classification: "expected_429" },
      {
        route: "/profile",
        durationMs: 40,
        status: 503,
        classification: "server_error",
        poolSignal: true,
        rawBody: "53300 super-secret-body",
      },
      { route: "/catalog/cards", durationMs: 5, status: 413, classification: "expected_413" },
      { route: "/catalog/cards", durationMs: 100, status: 400, classification: "client_error" },
      {
        route: "/catalog/cards/:id",
        durationMs: 0,
        status: null,
        classification: null,
        skippedNoCards: true,
      },
      {
        route: "/auth/telegram",
        durationMs: 15,
        status: null,
        classification: null,
        errorKind: "transport",
        token: "jwt-secret",
      },
      {
        route: "/catalog/cards",
        durationMs: 25,
        status: null,
        classification: null,
        errorKind: "protocol",
      },
    ];

    const summary = summarize(samples);

    expect(summary).toMatchObject({
      total: 8,
      normalSuccesses: 2,
      status413: 1,
      status429: 1,
      clientErrors4xx: 1,
      serverErrors5xx: 1,
      poolSignals: 1,
      skippedNoCards: 1,
      transportErrors: 1,
      protocolErrors: 1,
    });
    expect(summary.routes.find((route) => route.route === "/profile")).toMatchObject({
      total: 4,
      p50Ms: 20,
      p95Ms: 40,
      p99Ms: 40,
      status429: 1,
      serverErrors5xx: 1,
      poolSignals: 1,
    });
    expect(summary.routes.find((route) => route.route === "/catalog/cards")).toMatchObject({
      total: 3,
      p50Ms: 25,
      p95Ms: 100,
      p99Ms: 100,
      status413: 1,
      clientErrors4xx: 1,
      protocolErrors: 1,
    });
    expect(summary.routes.find((route) => route.route === "/catalog/cards/:id")).toMatchObject({
      total: 0,
      p50Ms: null,
      p95Ms: null,
      p99Ms: null,
      skippedNoCards: 1,
    });

    const serialized = JSON.stringify(summary);
    expect(serialized).not.toContain("super-secret-body");
    expect(serialized).not.toContain("jwt-secret");
    expect(serialized).not.toContain("rawBody");
    expect(serialized).not.toContain("token");
  });
});
