import { signInitData, type TgUserPayload } from "../helpers/telegramAuth";

export const LOAD_TEST_LIMITS = Object.freeze({
  maxUsers: 2_000,
  maxConcurrency: 200,
  maxDurationSeconds: 30 * 60,
  maxRateLimitProbeRequests: 200,
  rateProbeConcurrency: 10,
  rateProbeDeadlineMs: 45_000,
  requestTimeoutMs: 30_000,
  jsonBodyLimitBytes: 256 * 1024,
});

const TEST_TELEGRAM_ID_BASE = 8_000_000_000_000_000;
const TEST_PHONE = "+77000000000";
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type LoadEnvironment = Readonly<Record<string, string | undefined>>;

export interface LoadConfig {
  apiOrigin: string;
  botToken: string;
  users: number;
  concurrency: number;
  durationSeconds: number;
  mutationsEnabled: boolean;
  rateLimitProbeEnabled: boolean;
  runId: string;
}

export type CatalogType = "product" | "service";
export type ExpectedResponseKind = "normal" | "oversized_probe" | "rate_limit_probe";
export type ResponseClassification =
  | "normal_success"
  | "expected_413"
  | "expected_429"
  | "redirect_error"
  | "client_error"
  | "server_error";

export interface LoadRequest {
  route: string;
  method: "GET" | "POST";
  path: string;
  headers: Readonly<Record<string, string>>;
  body?: string;
  expectedKind: ExpectedResponseKind;
}

export interface ReadJourney {
  requests: readonly LoadRequest[];
  buildCardDetail(listResponse: unknown): LoadRequest | null;
}

export interface RequestPayload {
  clientRequestId: string;
  source: "profile";
  contactName: string;
  contactPhone: string;
  comment: string;
}

export interface FeedbackPayload {
  contactName: string;
  contactPhone: string;
  message: string;
}

export interface LoadSample {
  route: string;
  durationMs: number;
  status: number | null;
  classification: ResponseClassification | null;
  poolSignal?: boolean;
  skippedNoCards?: boolean;
  errorKind?: "transport" | "protocol";
}

export interface SummaryCounts {
  total: number;
  normalSuccesses: number;
  status413: number;
  status429: number;
  redirectErrors: number;
  clientErrors4xx: number;
  serverErrors5xx: number;
  poolSignals: number;
  skippedNoCards: number;
  transportErrors: number;
  protocolErrors: number;
}

export interface RouteSummary extends SummaryCounts {
  route: string;
  p50Ms: number | null;
  p95Ms: number | null;
  p99Ms: number | null;
}

export interface LoadSummary extends SummaryCounts {
  routes: RouteSummary[];
}

class LoadConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LoadConfigError";
  }
}

function configError(name: string, rule: string): never {
  throw new LoadConfigError(`${name}: ${rule}`);
}

function requireValue(env: LoadEnvironment, name: string): string {
  const value = env[name];
  if (value === undefined || value.length === 0) {
    configError(name, "required");
  }
  return value;
}

function parseApiOrigin(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    configError("LOAD_TEST_API_URL", "must be an absolute http(s) URL");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    configError("LOAD_TEST_API_URL", "only http: and https: are allowed");
  }
  if (url.username || url.password) {
    configError("LOAD_TEST_API_URL", "credentials are forbidden");
  }
  if (url.search || url.hash) {
    configError("LOAD_TEST_API_URL", "query and hash are forbidden");
  }
  if (url.pathname !== "/") {
    configError("LOAD_TEST_API_URL", "path must be empty or /");
  }
  if (url.origin === "null") {
    configError("LOAD_TEST_API_URL", "origin is invalid");
  }
  return url.origin;
}

function parsePositiveInteger(
  env: LoadEnvironment,
  name: string,
  upperBound: number,
): number {
  const raw = requireValue(env, name);
  if (!/^[1-9]\d*$/.test(raw)) {
    configError(name, "must be a positive integer");
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value > upperBound) {
    configError(name, `must not exceed ${upperBound}`);
  }
  return value;
}

function parseOptInFlag(env: LoadEnvironment, name: string): boolean {
  const value = env[name];
  if (value === undefined || value === "0") return false;
  if (value === "1") return true;
  configError(name, "must be 0, 1, or unset");
}

function hash32(value: string, seed = 0): number {
  let hash = (2_166_136_261 ^ seed) >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619) >>> 0;
  }
  return hash;
}

function deterministicUuid(value: string): string {
  const hex = [0, 1, 2, 3]
    .map((seed) => hash32(value, seed).toString(16).padStart(8, "0"))
    .join("");
  const variant = ((Number.parseInt(hex.slice(16, 17), 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export function parseLoadConfig(env: LoadEnvironment): LoadConfig {
  const apiOrigin = parseApiOrigin(requireValue(env, "LOAD_TEST_API_URL"));
  if (requireValue(env, "LOAD_TEST_ALLOW_TARGET") !== apiOrigin) {
    configError("LOAD_TEST_ALLOW_TARGET", "must exactly equal the normalized API origin");
  }

  const botToken = env.LOAD_TEST_TELEGRAM_BOT_TOKEN ?? env.TELEGRAM_BOT_TOKEN;
  if (botToken === undefined || botToken.length === 0) {
    configError("LOAD_TEST_TELEGRAM_BOT_TOKEN", "required (or use TELEGRAM_BOT_TOKEN fallback)");
  }

  const users = parsePositiveInteger(env, "LOAD_TEST_USERS", LOAD_TEST_LIMITS.maxUsers);
  const concurrency = parsePositiveInteger(
    env,
    "LOAD_TEST_CONCURRENCY",
    LOAD_TEST_LIMITS.maxConcurrency,
  );
  const durationSeconds = parsePositiveInteger(
    env,
    "LOAD_TEST_DURATION_SECONDS",
    LOAD_TEST_LIMITS.maxDurationSeconds,
  );
  if (concurrency > users) {
    configError("LOAD_TEST_CONCURRENCY", "must not exceed LOAD_TEST_USERS");
  }

  const mutationsEnabled = parseOptInFlag(env, "LOAD_TEST_ENABLE_MUTATIONS");
  const rateLimitProbeEnabled = parseOptInFlag(env, "LOAD_TEST_RATE_LIMIT_PROBE");
  if (mutationsEnabled) {
    if (env.LOAD_TEST_ALLOW_WRITE_TARGET !== apiOrigin) {
      configError("LOAD_TEST_ALLOW_WRITE_TARGET", "must exactly equal the normalized API origin");
    }
    if (env.LOAD_TEST_NOTIFICATIONS_DISABLED_CONFIRMED !== "1") {
      configError("LOAD_TEST_NOTIFICATIONS_DISABLED_CONFIRMED", "must be 1");
    }
  }

  const derivedRunId = deterministicUuid(
    `${apiOrigin}:${users}:${concurrency}:${durationSeconds}:${mutationsEnabled}:${rateLimitProbeEnabled}`,
  );
  const runId = env.LOAD_TEST_RUN_ID ?? derivedRunId;
  if (!UUID_V4_PATTERN.test(runId)) {
    configError("LOAD_TEST_RUN_ID", "must be a UUID v4 when provided");
  }

  return {
    apiOrigin,
    botToken,
    users,
    concurrency,
    durationSeconds,
    mutationsEnabled,
    rateLimitProbeEnabled,
    runId: runId.toLowerCase(),
  };
}

function assertUserIndex(index: number): void {
  if (!Number.isSafeInteger(index) || index < 0 || index >= LOAD_TEST_LIMITS.maxUsers) {
    throw new RangeError(`user index must be between 0 and ${LOAD_TEST_LIMITS.maxUsers - 1}`);
  }
}

export function buildUser(index: number, runId: string): TgUserPayload {
  assertUserIndex(index);
  if (runId.length === 0) throw new TypeError("runId must not be empty");

  const slotWidth = LOAD_TEST_LIMITS.maxUsers;
  const id = TEST_TELEGRAM_ID_BASE + hash32(runId) * slotWidth + index;
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new RangeError("derived Telegram id is not a positive safe integer");
  }

  return {
    id,
    first_name: "[load-test]",
    last_name: `${runId.slice(0, 8)}-user-${index}`,
  };
}

function authenticatedHeaders(token: string): Readonly<Record<string, string>> {
  return {
    accept: "application/json",
    authorization: `Bearer ${token}`,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function buildReadJourney(token: string, type: CatalogType): ReadJourney {
  const headers = authenticatedHeaders(token);
  const requests: readonly LoadRequest[] = [
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
      path: `/catalog/categories?type=${type}`,
      headers,
      expectedKind: "normal",
    },
    {
      route: "/catalog/cards",
      method: "GET",
      path: `/catalog/cards?type=${type}&limit=1&offset=0`,
      headers,
      expectedKind: "normal",
    },
  ];

  return {
    requests,
    buildCardDetail(listResponse: unknown): LoadRequest | null {
      if (!isRecord(listResponse) || !Array.isArray(listResponse.items)) {
        throw new TypeError("Invalid catalog cards response");
      }
      if (listResponse.items.length === 0) return null;

      const first = listResponse.items[0];
      if (!isRecord(first) || typeof first.id !== "string" || !UUID_PATTERN.test(first.id)) {
        throw new TypeError("Invalid catalog cards response");
      }

      return {
        route: "/catalog/cards/:id",
        method: "GET",
        path: `/catalog/cards/${first.id}`,
        headers,
        expectedKind: "normal",
      };
    },
  };
}

function contactName(runId: string, userIndex: number): string {
  assertUserIndex(userIndex);
  return `[load-test] ${runId.slice(0, 8)} user ${userIndex}`;
}

export function buildRequestPayload(runId: string, userIndex: number): RequestPayload {
  return {
    clientRequestId: deterministicUuid(`${runId}:request:${userIndex}`),
    source: "profile",
    contactName: contactName(runId, userIndex),
    contactPhone: TEST_PHONE,
    comment: `[load-test] run=${runId} user=${userIndex}`,
  };
}

export function buildFeedbackPayload(runId: string, userIndex: number): FeedbackPayload {
  return {
    contactName: contactName(runId, userIndex),
    contactPhone: TEST_PHONE,
    message: `[load-test] run=${runId} user=${userIndex}`,
  };
}

export function makeOversizedJson(limitBytes: number): string {
  if (!Number.isSafeInteger(limitBytes) || limitBytes < 0 || limitBytes > 10 * 1024 * 1024) {
    throw new RangeError("limitBytes must be a non-negative integer no greater than 10 MiB");
  }
  return `${" ".repeat(limitBytes)}0`;
}

export function classifyResponse(
  status: number,
  expectedKind: ExpectedResponseKind,
): ResponseClassification {
  if (!Number.isInteger(status) || status < 100 || status > 599) {
    throw new RangeError("status must be an HTTP status code");
  }
  if (status >= 200 && status < 300) return "normal_success";
  if (status === 413 && expectedKind === "oversized_probe") return "expected_413";
  if (status === 429 && expectedKind === "rate_limit_probe") return "expected_429";
  if (status >= 300 && status < 400) return "redirect_error";
  if (status >= 500) return "server_error";
  return "client_error";
}

interface MutableSummary extends SummaryCounts {
  durations: number[];
}

function emptyMutableSummary(): MutableSummary {
  return {
    total: 0,
    normalSuccesses: 0,
    status413: 0,
    status429: 0,
    redirectErrors: 0,
    clientErrors4xx: 0,
    serverErrors5xx: 0,
    poolSignals: 0,
    skippedNoCards: 0,
    transportErrors: 0,
    protocolErrors: 0,
    durations: [],
  };
}

function observeSample(target: MutableSummary, sample: LoadSample): void {
  if (sample.skippedNoCards) {
    target.skippedNoCards += 1;
    return;
  }

  target.total += 1;
  target.durations.push(Math.max(0, sample.durationMs));
  if (sample.classification === "normal_success") target.normalSuccesses += 1;
  if (sample.status === 413) target.status413 += 1;
  if (sample.status === 429) target.status429 += 1;
  if (sample.classification === "redirect_error") target.redirectErrors += 1;
  if (sample.classification === "client_error") target.clientErrors4xx += 1;
  if (sample.classification === "server_error") target.serverErrors5xx += 1;
  if (sample.poolSignal) target.poolSignals += 1;
  if (sample.errorKind === "transport") target.transportErrors += 1;
  if (sample.errorKind === "protocol") target.protocolErrors += 1;
}

function percentile(durations: readonly number[], fraction: number): number | null {
  if (durations.length === 0) return null;
  const sorted = [...durations].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil(fraction * sorted.length) - 1);
  return sorted[index] ?? null;
}

function countsFrom(source: MutableSummary): SummaryCounts {
  return {
    total: source.total,
    normalSuccesses: source.normalSuccesses,
    status413: source.status413,
    status429: source.status429,
    redirectErrors: source.redirectErrors,
    clientErrors4xx: source.clientErrors4xx,
    serverErrors5xx: source.serverErrors5xx,
    poolSignals: source.poolSignals,
    skippedNoCards: source.skippedNoCards,
    transportErrors: source.transportErrors,
    protocolErrors: source.protocolErrors,
  };
}

export function summarize(samples: readonly LoadSample[]): LoadSummary {
  const total = emptyMutableSummary();
  const byRoute = new Map<string, MutableSummary>();

  for (const sample of samples) {
    observeSample(total, sample);
    const route = byRoute.get(sample.route) ?? emptyMutableSummary();
    observeSample(route, sample);
    byRoute.set(sample.route, route);
  }

  const routes = [...byRoute.entries()]
    .map(([route, values]): RouteSummary => ({
      route,
      ...countsFrom(values),
      p50Ms: percentile(values.durations, 0.5),
      p95Ms: percentile(values.durations, 0.95),
      p99Ms: percentile(values.durations, 0.99),
    }))
    .sort((left, right) => left.route.localeCompare(right.route));

  return {
    ...countsFrom(total),
    routes,
  };
}

interface ExecutedRequest {
  sample: LoadSample;
  response: Response | null;
  bodyText: string;
}

interface AuthenticatedUser {
  index: number;
  token: string;
}

interface RateLimitProbeResult {
  enabled: boolean;
  passed: boolean | null;
  attempts: number;
  maxRequests: number;
  concurrency: number;
  deadlineMs: number;
  retryAfterSeconds: number | null;
}

export interface ProbeBatchOptions {
  maxRequests: number;
  concurrency: number;
  deadlineAtMs: number;
  now?: () => number;
}

export interface ProbeDecision<Value> {
  stop: boolean;
  value: Value;
}

export interface ProbeBatchResult<Value> {
  attempts: number;
  stopped: boolean;
  stopValue: Value | null;
  deadlineReached: boolean;
  operationFailed: boolean;
}

function elapsedMs(startedAt: number): number {
  return Math.round((performance.now() - startedAt) * 100) / 100;
}

function hasPoolSignal(status: number, bodyText: string): boolean {
  if (status < 500) return false;
  return (
    bodyText.includes("53300") ||
    /remaining connection slots/i.test(bodyText) ||
    /too many (?:clients|connections)/i.test(bodyText) ||
    /connection pool (?:exhausted|timeout)/i.test(bodyText)
  );
}

async function executeHttp(
  apiOrigin: string,
  request: LoadRequest,
  samples: LoadSample[],
  deadlineAtMs?: number,
): Promise<ExecutedRequest> {
  const startedAt = performance.now();
  try {
    const remainingMs =
      deadlineAtMs === undefined
        ? LOAD_TEST_LIMITS.requestTimeoutMs
        : deadlineAtMs - performance.now();
    if (remainingMs <= 0) throw new Error("request deadline reached");
    const timeoutMs = Math.max(
      1,
      Math.ceil(Math.min(LOAD_TEST_LIMITS.requestTimeoutMs, remainingMs)),
    );
    const response = await fetch(`${apiOrigin}${request.path}`, {
      method: request.method,
      headers: { ...request.headers },
      body: request.body,
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
    });
    const bodyText = await response.text();
    const sample: LoadSample = {
      route: request.route,
      durationMs: elapsedMs(startedAt),
      status: response.status,
      classification: classifyResponse(response.status, request.expectedKind),
      poolSignal: hasPoolSignal(response.status, bodyText),
    };
    samples.push(sample);
    return { sample, response, bodyText };
  } catch {
    const sample: LoadSample = {
      route: request.route,
      durationMs: elapsedMs(startedAt),
      status: null,
      classification: null,
      errorKind: "transport",
    };
    samples.push(sample);
    return { sample, response: null, bodyText: "" };
  }
}

function jsonRequest(
  route: string,
  path: string,
  body: unknown,
  expectedKind: ExpectedResponseKind,
  token?: string,
): LoadRequest {
  return {
    route,
    method: "POST",
    path,
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
    expectedKind,
  };
}

function parseResponseJson(result: ExecutedRequest): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(result.bodyText) as unknown };
  } catch {
    result.sample.errorKind = "protocol";
    return { ok: false };
  }
}

function markProtocolError(result: ExecutedRequest): void {
  result.sample.errorKind = "protocol";
}

async function authenticateUser(
  config: LoadConfig,
  userIndex: number,
  identityRunId: string,
  samples: LoadSample[],
): Promise<AuthenticatedUser | null> {
  const user = buildUser(userIndex, identityRunId);
  let initData: string;
  const startedAt = performance.now();
  try {
    initData = await signInitData(config.botToken, user);
  } catch {
    samples.push({
      route: "/auth/telegram",
      durationMs: elapsedMs(startedAt),
      status: null,
      classification: null,
      errorKind: "protocol",
    });
    return null;
  }

  const result = await executeHttp(
    config.apiOrigin,
    jsonRequest("/auth/telegram", "/auth/telegram", { initData }, "normal"),
    samples,
  );
  if (result.sample.classification !== "normal_success") return null;

  const parsed = parseResponseJson(result);
  if (!parsed.ok || !isRecord(parsed.value) || typeof parsed.value.token !== "string" || !parsed.value.token) {
    markProtocolError(result);
    return null;
  }

  return { index: userIndex, token: parsed.value.token };
}

async function mapBounded<T, Result>(
  values: readonly T[],
  concurrency: number,
  operation: (value: T, index: number) => Promise<Result>,
): Promise<Result[]> {
  const results = new Array<Result>(values.length);
  let cursor = 0;

  async function worker(): Promise<void> {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= values.length) return;
      results[index] = await operation(values[index] as T, index);
    }
  }

  const workerCount = Math.min(concurrency, values.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

export async function runBoundedProbeBatches<Value>(
  options: ProbeBatchOptions,
  operation: (attempt: number, deadlineAtMs: number) => Promise<ProbeDecision<Value>>,
): Promise<ProbeBatchResult<Value>> {
  if (!Number.isSafeInteger(options.maxRequests) || options.maxRequests <= 0) {
    throw new RangeError("maxRequests must be a positive safe integer");
  }
  if (!Number.isSafeInteger(options.concurrency) || options.concurrency <= 0) {
    throw new RangeError("concurrency must be a positive safe integer");
  }
  if (!Number.isFinite(options.deadlineAtMs)) {
    throw new RangeError("deadlineAtMs must be finite");
  }

  const now = options.now ?? (() => performance.now());
  let attempts = 0;

  while (attempts < options.maxRequests && now() < options.deadlineAtMs) {
    const batchSize = Math.min(options.concurrency, options.maxRequests - attempts);
    const attemptNumbers = Array.from({ length: batchSize }, (_, index) => attempts + index + 1);
    attempts += batchSize;

    let stopped = false;
    let stopValue: Value | null = null;
    const inFlight = attemptNumbers.map((attempt) =>
      operation(attempt, options.deadlineAtMs).then((decision) => {
        if (decision.stop && !stopped) {
          stopped = true;
          stopValue = decision.value;
        }
        return decision;
      }),
    );
    const settled = await Promise.allSettled(inFlight);
    const operationFailed = settled.some((result) => result.status === "rejected");

    if (stopped || operationFailed) {
      return {
        attempts,
        stopped,
        stopValue,
        deadlineReached: now() >= options.deadlineAtMs,
        operationFailed,
      };
    }
  }

  return {
    attempts,
    stopped: false,
    stopValue: null,
    deadlineReached: now() >= options.deadlineAtMs,
    operationFailed: false,
  };
}

async function executeMutationFlow(
  config: LoadConfig,
  user: AuthenticatedUser,
  samples: LoadSample[],
): Promise<void> {
  const requestPayload = buildRequestPayload(config.runId, user.index);
  await executeHttp(
    config.apiOrigin,
    jsonRequest("/requests", "/requests", requestPayload, "normal", user.token),
    samples,
  );
  await executeHttp(
    config.apiOrigin,
    jsonRequest(
      "/profile/register",
      "/profile/register",
      {
        contactName: requestPayload.contactName,
        contactPhone: requestPayload.contactPhone,
      },
      "normal",
      user.token,
    ),
    samples,
  );
  await executeHttp(
    config.apiOrigin,
    jsonRequest(
      "/feedback",
      "/feedback",
      buildFeedbackPayload(config.runId, user.index),
      "normal",
      user.token,
    ),
    samples,
  );
}

async function executeReadJourney(
  config: LoadConfig,
  user: AuthenticatedUser,
  type: CatalogType,
  samples: LoadSample[],
): Promise<void> {
  const journey = buildReadJourney(user.token, type);
  let cardsResult: ExecutedRequest | null = null;

  for (const request of journey.requests) {
    const result = await executeHttp(config.apiOrigin, request, samples);
    if (request.route === "/catalog/cards") cardsResult = result;
  }

  if (!cardsResult || cardsResult.sample.classification !== "normal_success") return;
  const parsed = parseResponseJson(cardsResult);
  if (!parsed.ok) return;

  let detailRequest: LoadRequest | null;
  try {
    detailRequest = journey.buildCardDetail(parsed.value);
  } catch {
    markProtocolError(cardsResult);
    return;
  }

  if (!detailRequest) {
    samples.push({
      route: "/catalog/cards/:id",
      durationMs: 0,
      status: null,
      classification: null,
      skippedNoCards: true,
    });
    return;
  }

  await executeHttp(config.apiOrigin, detailRequest, samples);
}

async function runReadLoad(
  config: LoadConfig,
  users: readonly AuthenticatedUser[],
  samples: LoadSample[],
): Promise<void> {
  if (users.length === 0) return;
  const deadline = performance.now() + config.durationSeconds * 1_000;

  await mapBounded(users, config.concurrency, async (user, index) => {
    await executeReadJourney(config, user, index % 2 === 0 ? "product" : "service", samples);
  });

  let cursor = 0;
  async function repeatWorker(): Promise<void> {
    while (performance.now() < deadline) {
      const position = cursor;
      cursor += 1;
      const user = users[position % users.length];
      if (!user) return;
      await executeReadJourney(
        config,
        user,
        position % 2 === 0 ? "product" : "service",
        samples,
      );
    }
  }

  const workerCount = Math.min(config.concurrency, users.length);
  await Promise.all(Array.from({ length: workerCount }, () => repeatWorker()));
}

async function runOversizedProbe(config: LoadConfig, samples: LoadSample[]): Promise<boolean> {
  const body = makeOversizedJson(LOAD_TEST_LIMITS.jsonBodyLimitBytes);
  const result = await executeHttp(
    config.apiOrigin,
    {
      route: "/auth/telegram",
      method: "POST",
      path: "/auth/telegram",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      body,
      expectedKind: "oversized_probe",
    },
    samples,
  );
  return result.sample.classification === "expected_413";
}

function rateProbeRequest(token: string): LoadRequest {
  return {
    route: "/profile",
    method: "GET",
    path: "/profile",
    headers: authenticatedHeaders(token),
    expectedKind: "rate_limit_probe",
  };
}

async function runRateLimitProbe(
  config: LoadConfig,
  samples: LoadSample[],
): Promise<RateLimitProbeResult> {
  if (!config.rateLimitProbeEnabled) {
    return {
      enabled: false,
      passed: null,
      attempts: 0,
      maxRequests: LOAD_TEST_LIMITS.maxRateLimitProbeRequests,
      concurrency: LOAD_TEST_LIMITS.rateProbeConcurrency,
      deadlineMs: LOAD_TEST_LIMITS.rateProbeDeadlineMs,
      retryAfterSeconds: null,
    };
  }

  const probeUser = await authenticateUser(config, 0, `${config.runId}:rate-probe`, samples);
  if (!probeUser) {
    return {
      enabled: true,
      passed: false,
      attempts: 0,
      maxRequests: LOAD_TEST_LIMITS.maxRateLimitProbeRequests,
      concurrency: LOAD_TEST_LIMITS.rateProbeConcurrency,
      deadlineMs: LOAD_TEST_LIMITS.rateProbeDeadlineMs,
      retryAfterSeconds: null,
    };
  }

  const deadlineAtMs = performance.now() + LOAD_TEST_LIMITS.rateProbeDeadlineMs;
  const batchResult = await runBoundedProbeBatches(
    {
      maxRequests: LOAD_TEST_LIMITS.maxRateLimitProbeRequests,
      concurrency: LOAD_TEST_LIMITS.rateProbeConcurrency,
      deadlineAtMs,
    },
    async (attempt, requestDeadlineAtMs) => {
      const result = await executeHttp(
        config.apiOrigin,
        rateProbeRequest(probeUser.token),
        samples,
        requestDeadlineAtMs,
      );
      return {
        stop: result.sample.classification !== "normal_success",
        value: { attempt, result },
      };
    },
  );

  const stoppedRequest = batchResult.stopValue;
  if (
    batchResult.operationFailed ||
    !batchResult.stopped ||
    !stoppedRequest ||
    stoppedRequest.result.sample.classification !== "expected_429"
  ) {
    return {
      enabled: true,
      passed: false,
      attempts: batchResult.attempts,
      maxRequests: LOAD_TEST_LIMITS.maxRateLimitProbeRequests,
      concurrency: LOAD_TEST_LIMITS.rateProbeConcurrency,
      deadlineMs: LOAD_TEST_LIMITS.rateProbeDeadlineMs,
      retryAfterSeconds: null,
    };
  }

  const result = stoppedRequest.result;
  const retryAfterHeader = result.response?.headers.get("retry-after")?.trim() ?? "";
  const retryAfter = /^[1-9]\d*$/.test(retryAfterHeader) ? Number(retryAfterHeader) : null;
  const parsed = parseResponseJson(result);
  const bodyRetryAfter =
    parsed.ok && isRecord(parsed.value) ? parsed.value.retryAfterSeconds : undefined;
  const valid =
    retryAfter !== null &&
    Number.isSafeInteger(retryAfter) &&
    typeof bodyRetryAfter === "number" &&
    Number.isSafeInteger(bodyRetryAfter) &&
    bodyRetryAfter > 0 &&
    bodyRetryAfter === retryAfter;
  if (!valid) markProtocolError(result);

  return {
    enabled: true,
    passed: valid,
    attempts: batchResult.attempts,
    maxRequests: LOAD_TEST_LIMITS.maxRateLimitProbeRequests,
    concurrency: LOAD_TEST_LIMITS.rateProbeConcurrency,
    deadlineMs: LOAD_TEST_LIMITS.rateProbeDeadlineMs,
    retryAfterSeconds: valid ? retryAfter : null,
  };
}

export function hasRunFailure(
  summary: LoadSummary,
  oversizedProbePassed: boolean,
  rateLimitProbe: { enabled: boolean; passed: boolean | null },
): boolean {
  return (
    !oversizedProbePassed ||
    (rateLimitProbe.enabled && rateLimitProbe.passed !== true) ||
    summary.redirectErrors > 0 ||
    summary.clientErrors4xx > 0 ||
    summary.serverErrors5xx > 0 ||
    summary.poolSignals > 0 ||
    summary.transportErrors > 0 ||
    summary.protocolErrors > 0
  );
}

async function runLoadTest(config: LoadConfig): Promise<number> {
  const startedAt = new Date().toISOString();
  const samples: LoadSample[] = [];
  const oversizedProbePassed = await runOversizedProbe(config, samples);
  const indexes = Array.from({ length: config.users }, (_, index) => index);
  const authenticated = await mapBounded(indexes, config.concurrency, (index) =>
    authenticateUser(config, index, config.runId, samples),
  );
  const users = authenticated.filter((user): user is AuthenticatedUser => user !== null);

  if (config.mutationsEnabled) {
    await mapBounded(users, config.concurrency, async (user) => {
      await executeMutationFlow(config, user, samples);
    });
  }

  await runReadLoad(config, users, samples);
  const rateLimitProbe = await runRateLimitProbe(config, samples);
  const summary = summarize(samples);
  const failed = hasRunFailure(summary, oversizedProbePassed, rateLimitProbe);
  const output = {
    run: {
      runId: config.runId,
      apiOrigin: config.apiOrigin,
      configuredUsers: config.users,
      authenticatedUsers: users.length,
      concurrency: config.concurrency,
      durationSeconds: config.durationSeconds,
      mutationsEnabled: config.mutationsEnabled,
      rateLimitProbeEnabled: config.rateLimitProbeEnabled,
      startedAt,
      finishedAt: new Date().toISOString(),
    },
    probes: {
      oversized: {
        passed: oversizedProbePassed,
        expectedStatus: 413,
        bodyBytes: LOAD_TEST_LIMITS.jsonBodyLimitBytes + 1,
      },
      rateLimit: rateLimitProbe,
    },
    summary,
    failed,
  };

  console.log(JSON.stringify(output, null, 2));
  return failed ? 1 : 0;
}

function runtimeEnvironment(): LoadEnvironment {
  return {
    LOAD_TEST_API_URL: Bun.env.LOAD_TEST_API_URL,
    LOAD_TEST_ALLOW_TARGET: Bun.env.LOAD_TEST_ALLOW_TARGET,
    LOAD_TEST_TELEGRAM_BOT_TOKEN: Bun.env.LOAD_TEST_TELEGRAM_BOT_TOKEN,
    TELEGRAM_BOT_TOKEN: Bun.env.TELEGRAM_BOT_TOKEN,
    LOAD_TEST_USERS: Bun.env.LOAD_TEST_USERS,
    LOAD_TEST_CONCURRENCY: Bun.env.LOAD_TEST_CONCURRENCY,
    LOAD_TEST_DURATION_SECONDS: Bun.env.LOAD_TEST_DURATION_SECONDS,
    LOAD_TEST_ENABLE_MUTATIONS: Bun.env.LOAD_TEST_ENABLE_MUTATIONS,
    LOAD_TEST_ALLOW_WRITE_TARGET: Bun.env.LOAD_TEST_ALLOW_WRITE_TARGET,
    LOAD_TEST_NOTIFICATIONS_DISABLED_CONFIRMED:
      Bun.env.LOAD_TEST_NOTIFICATIONS_DISABLED_CONFIRMED,
    LOAD_TEST_RATE_LIMIT_PROBE: Bun.env.LOAD_TEST_RATE_LIMIT_PROBE,
    LOAD_TEST_RUN_ID: Bun.env.LOAD_TEST_RUN_ID ?? crypto.randomUUID(),
  };
}

if (import.meta.main) {
  try {
    const exitCode = await runLoadTest(parseLoadConfig(runtimeEnvironment()));
    process.exitCode = exitCode;
  } catch (error) {
    if (error instanceof LoadConfigError) {
      console.error(error.message);
    } else {
      console.error("Load test execution failed before an aggregate summary was available");
    }
    process.exitCode = 1;
  }
}
