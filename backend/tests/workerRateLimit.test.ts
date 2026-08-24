import { describe, expect, test } from "bun:test";
import { createApp } from "../src/app";
import type { AppEnv } from "../src/env";
import { issueToken } from "../src/lib/jwt";
import { createRequireAuth } from "../src/middleware/auth";
import { authenticatedRouteGroup } from "../src/middleware/rateLimit";

const USER_ID = "45d5fe54-f20b-4fe4-9e22-cad4f7751a47";
const TELEGRAM_ID = 777;
const JWT_SECRET = "rate-limit-test-secret";

type LimitResult = { success: boolean };

class RateLimitMock {
  readonly calls: Array<{ key: string }> = [];

  constructor(private readonly result: LimitResult) {}

  async limit(options: { key: string }): Promise<LimitResult> {
    this.calls.push(options);
    return this.result;
  }
}

type RateLimitTestEnv = Partial<AppEnv> & {
  API_READ_RATE_LIMITER?: RateLimitMock;
  API_MUTATION_RATE_LIMITER?: RateLimitMock;
  AUTH_RATE_LIMITER?: RateLimitMock;
  AUTH_IDENTITY_RATE_LIMITER?: RateLimitMock;
};

async function authorizationHeader(): Promise<Record<string, string>> {
  const token = await issueToken({ JWT_SECRET } as AppEnv, USER_ID, TELEGRAM_ID, 0);
  return { Authorization: `Bearer ${token}` };
}

function createRateLimitApp(env: RateLimitTestEnv) {
  return createApp({
    env: {
      JWT_SECRET,
      ADMIN_ALLOWLIST: String(TELEGRAM_ID),
      ...env,
    } as Partial<AppEnv>,
  });
}

const requireAuth = createRequireAuth(async () => ({ tokenVersion: 0, isRegistered: true }));

describe("Cloudflare authenticated rate limiting", () => {
  test("GET передаёт read binding только userId и rejection останавливает handler", async () => {
    const readLimiter = new RateLimitMock({ success: false });
    const mutationLimiter = new RateLimitMock({ success: true });
    const app = createRateLimitApp({
      API_READ_RATE_LIMITER: readLimiter,
      API_MUTATION_RATE_LIMITER: mutationLimiter,
    });
    let handlerCalls = 0;
    app.get("/__security/read/:id", requireAuth, (c) => {
      handlerCalls += 1;
      return c.json({ ok: true });
    });

    const response = await app.request("/__security/read/dynamic-1?sort=desc", {
      headers: await authorizationHeader(),
    });

    expect(readLimiter.calls).toEqual([{ key: USER_ID }]);
    expect(mutationLimiter.calls).toEqual([]);
    expect(handlerCalls).toBe(0);
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("60");
    expect(await response.json()).toEqual({
      error: "Слишком много запросов",
      code: "RATE_LIMITED",
      requestId: expect.any(String),
      retryAfterSeconds: 60,
    });
  });

  test("HEAD считается безопасным чтением", async () => {
    const readLimiter = new RateLimitMock({ success: false });
    const mutationLimiter = new RateLimitMock({ success: true });
    const app = createRateLimitApp({
      API_READ_RATE_LIMITER: readLimiter,
      API_MUTATION_RATE_LIMITER: mutationLimiter,
    });
    app.use("/__security/head", requireAuth);
    app.all("/__security/head", (c) => c.body(null, 204));

    const response = await app.request("/__security/head", {
      method: "HEAD",
      headers: await authorizationHeader(),
    });

    expect(response.status).toBe(429);
    expect(readLimiter.calls).toEqual([{ key: USER_ID }]);
    expect(mutationLimiter.calls).toEqual([]);
  });

  test("mutation binding получает userId и первую группу маршрута", async () => {
    const mutationLimiter = new RateLimitMock({ success: false });
    const app = createRateLimitApp({ API_MUTATION_RATE_LIMITER: mutationLimiter });
    app.post("/__security/items/:id", requireAuth, (c) => c.json({ ok: true }));

    await app.request("/__security/items/dynamic-1?source=one", {
      method: "POST",
      headers: await authorizationHeader(),
    });
    await app.request("/__security/items/dynamic-2?source=two", {
      method: "POST",
      headers: await authorizationHeader(),
    });

    expect(mutationLimiter.calls).toEqual([
      { key: `${USER_ID}:__security` },
      { key: `${USER_ID}:__security` },
    ]);
  });

  test("admin mutation использует admin:<second-segment> без ID и query string", async () => {
    const mutationLimiter = new RateLimitMock({ success: false });
    const app = createRateLimitApp({ API_MUTATION_RATE_LIMITER: mutationLimiter });
    app.post("/__security/admin/:id", requireAuth, (c) => c.json({ ok: true }));

    const response = await app.request("/__security/admin/card-dynamic-id?draft=true", {
      method: "POST",
      headers: await authorizationHeader(),
    });

    expect(response.status).toBe(429);
    expect(mutationLimiter.calls).toEqual([{ key: `${USER_ID}:__security` }]);
  });

  test("отсутствующий binding является no-op", async () => {
    const app = createRateLimitApp({});
    let handlerCalls = 0;
    app.get("/__security/no-binding", requireAuth, (c) => {
      handlerCalls += 1;
      return c.json({ ok: true });
    });

    const response = await app.request("/__security/no-binding", {
      headers: await authorizationHeader(),
    });

    expect(response.status).toBe(200);
    expect(handlerCalls).toBe(1);
    expect(await response.json()).toEqual({ ok: true });
  });

  test("auth и Telegram webhook остаются вне user-keyed limiter", async () => {
    const readLimiter = new RateLimitMock({ success: false });
    const mutationLimiter = new RateLimitMock({ success: false });
    const app = createRateLimitApp({
      API_READ_RATE_LIMITER: readLimiter,
      API_MUTATION_RATE_LIMITER: mutationLimiter,
      TELEGRAM_WEBHOOK_SECRET: "test-secret",
    });

    const authResponse = await app.request("/auth/widget", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    const webhookResponse = await app.request("/telegram/webhook", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Telegram-Bot-Api-Secret-Token": "test-secret",
      },
      body: "{}",
    });

    expect(authResponse.status).toBe(400);
    expect(webhookResponse.status).toBe(200);
    expect(readLimiter.calls).toEqual([]);
    expect(mutationLimiter.calls).toEqual([]);
  });
});

describe("AUTH_RATE_LIMITER (pre-auth, по IP)", () => {
  test("превышение лимита возвращает 429 и ключуется по CF-Connecting-IP для /auth/telegram и /auth/widget", async () => {
    const authLimiter = new RateLimitMock({ success: false });
    const app = createRateLimitApp({ AUTH_RATE_LIMITER: authLimiter });

    const telegramResponse = await app.request("/auth/telegram", {
      method: "POST",
      headers: { "Content-Type": "application/json", "CF-Connecting-IP": "203.0.113.7" },
      body: "{}",
    });
    const widgetResponse = await app.request("/auth/widget", {
      method: "POST",
      headers: { "Content-Type": "application/json", "CF-Connecting-IP": "203.0.113.7" },
      body: "{}",
    });

    expect(telegramResponse.status).toBe(429);
    expect(widgetResponse.status).toBe(429);
    expect(authLimiter.calls).toEqual([{ key: "203.0.113.7" }, { key: "203.0.113.7" }]);
  });

  test("без CF-Connecting-IP использует запасной ключ, а не падает", async () => {
    const authLimiter = new RateLimitMock({ success: false });
    const app = createRateLimitApp({ AUTH_RATE_LIMITER: authLimiter });

    const response = await app.request("/auth/telegram", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });

    expect(response.status).toBe(429);
    expect(authLimiter.calls).toEqual([{ key: "unknown" }]);
  });

  test("отсутствующий binding является no-op — запрос доходит до валидации тела", async () => {
    const app = createRateLimitApp({});

    const response = await app.request("/auth/telegram", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });

    // Лимитер не блокирует — 400 приходит от Zod-валидации пустого тела, а не от rate limit.
    expect(response.status).toBe(400);
  });

  test("успешный limit() пропускает запрос дальше по цепочке", async () => {
    const authLimiter = new RateLimitMock({ success: true });
    const app = createRateLimitApp({ AUTH_RATE_LIMITER: authLimiter });

    const response = await app.request("/auth/telegram", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });

    expect(authLimiter.calls).toEqual([{ key: "unknown" }]);
    expect(response.status).toBe(400);
  });
});

function initDataWithUser(id: number): string {
  const params = new URLSearchParams();
  params.set("user", JSON.stringify({ id }));
  return params.toString();
}

describe("AUTH_IDENTITY_RATE_LIMITER (pre-auth, по IP + Telegram id)", () => {
  test("initData-логин ключуется по IP и Telegram id", async () => {
    const identityLimiter = new RateLimitMock({ success: true });
    const app = createRateLimitApp({ AUTH_IDENTITY_RATE_LIMITER: identityLimiter });

    const response = await app.request("/auth/telegram", {
      method: "POST",
      headers: { "Content-Type": "application/json", "CF-Connecting-IP": "203.0.113.7" },
      body: JSON.stringify({ initData: initDataWithUser(555) }),
    });

    expect(identityLimiter.calls).toEqual([{ key: "203.0.113.7:555" }]);
    expect(response.status).toBe(401);
  });

  test("widget-логин без IP-заголовка использует unknown + Telegram id", async () => {
    const identityLimiter = new RateLimitMock({ success: true });
    const app = createRateLimitApp({ AUTH_IDENTITY_RATE_LIMITER: identityLimiter });

    const response = await app.request("/auth/widget", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: 555 }),
    });

    expect(identityLimiter.calls).toEqual([{ key: "unknown:555" }]);
    expect(response.status).toBe(400);
  });

  test("битое JSON-тело даёт 400 и не вызывает identity limiter", async () => {
    const identityLimiter = new RateLimitMock({ success: true });
    const app = createRateLimitApp({ AUTH_IDENTITY_RATE_LIMITER: identityLimiter });

    const response = await app.request("/auth/telegram", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{not json",
    });

    expect(response.status).toBe(400);
    expect(identityLimiter.calls).toEqual([]);
  });

  test("отказ IP-потолка не доходит до identity limiter", async () => {
    const ipLimiter = new RateLimitMock({ success: false });
    const identityLimiter = new RateLimitMock({ success: true });
    const app = createRateLimitApp({
      AUTH_RATE_LIMITER: ipLimiter,
      AUTH_IDENTITY_RATE_LIMITER: identityLimiter,
    });

    const response = await app.request("/auth/telegram", {
      method: "POST",
      headers: { "Content-Type": "application/json", "CF-Connecting-IP": "203.0.113.7" },
      body: JSON.stringify({ initData: initDataWithUser(555) }),
    });

    expect(response.status).toBe(429);
    expect(ipLimiter.calls).toEqual([{ key: "203.0.113.7" }]);
    expect(identityLimiter.calls).toEqual([]);
  });

  test("identity limiter сам возвращает 429 и Retry-After", async () => {
    const identityLimiter = new RateLimitMock({ success: false });
    const app = createRateLimitApp({ AUTH_IDENTITY_RATE_LIMITER: identityLimiter });

    const response = await app.request("/auth/telegram", {
      method: "POST",
      headers: { "Content-Type": "application/json", "CF-Connecting-IP": "203.0.113.7" },
      body: JSON.stringify({ initData: initDataWithUser(555) }),
    });

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("60");
    expect(identityLimiter.calls).toEqual([{ key: "203.0.113.7:555" }]);
  });

  test("identity limiter работает без IP binding", async () => {
    const identityLimiter = new RateLimitMock({ success: true });
    const app = createRateLimitApp({ AUTH_IDENTITY_RATE_LIMITER: identityLimiter });

    const response = await app.request("/auth/telegram", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ initData: initDataWithUser(555) }),
    });

    expect(response.status).toBe(401);
    expect(identityLimiter.calls).toEqual([{ key: "unknown:555" }]);
  });

  test("без обоих auth bindings запрос доходит до Zod", async () => {
    const app = createRateLimitApp({});

    const response = await app.request("/auth/widget", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });

    expect(response.status).toBe(400);
  });

  test("Telegram id вне диапазона игнорируется", async () => {
    const identityLimiter = new RateLimitMock({ success: false });
    const app = createRateLimitApp({ AUTH_IDENTITY_RATE_LIMITER: identityLimiter });

    const response = await app.request("/auth/widget", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: 2 ** 52 + 1 }),
    });

    expect(response.status).toBe(400);
    expect(identityLimiter.calls).toEqual([]);
  });

  test("тело остаётся доступно обработчику после чтения в middleware", async () => {
    const identityLimiter = new RateLimitMock({ success: true });
    const app = createRateLimitApp({ AUTH_IDENTITY_RATE_LIMITER: identityLimiter });

    const response = await app.request("/auth/telegram", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ initData: initDataWithUser(555) }),
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: "Отсутствует подпись Telegram",
      code: "HTTP_ERROR",
      requestId: expect.any(String),
    });
    expect(identityLimiter.calls).toEqual([{ key: "unknown:555" }]);
  });
});

test("authenticatedRouteGroup strips dynamic admin IDs and query strings", () => {
  expect(authenticatedRouteGroup("/admin/users/45d5fe54-f20b-4fe4-9e22-cad4f7751a47/revoke-sessions?force=true")).toBe("admin:users");
});
