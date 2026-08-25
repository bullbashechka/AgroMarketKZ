import { describe, expect, spyOn, test } from "bun:test";
import { z } from "zod";
import { createApp } from "../src/app";
import type { AppEnv } from "../src/env";
import { HttpError } from "../src/lib/errors";

describe("security headers JSON API", () => {
  test("returns nosniff and does not forward Referer", async () => {
    const response = await createApp({ env: WEBHOOK_ENV }).request("/health");

    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
});

const JSON_BODY_LIMIT_BYTES = 256 * 1024;
const BODY_LIMIT_ERROR = { error: "Размер запроса превышает 256 KiB", code: "BODY_TOO_LARGE" };
const WEBHOOK_ENV: Partial<AppEnv> = {
  ADMIN_ALLOWLIST: "",
  TELEGRAM_WEBHOOK_SECRET: "test-secret",
};

function jsonBodyOfExactSize(size: number): string {
  const prefix = "{\"padding\":\"";
  const suffix = "\"}";
  return `${prefix}${"a".repeat(size - prefix.length - suffix.length)}${suffix}`;
}

function webhookHeaders(extra: Record<string, string> = {}): HeadersInit {
  return {
    "Content-Type": "application/json",
    "X-Telegram-Bot-Api-Secret-Token": "test-secret",
    ...extra,
  };
}

describe("ограничение размера request body", () => {
  test("принимает JSON размером ровно 256 KiB", async () => {
    const body = jsonBodyOfExactSize(JSON_BODY_LIMIT_BYTES);
    expect(new TextEncoder().encode(body).byteLength).toBe(JSON_BODY_LIMIT_BYTES);

    const response = await createApp({ env: WEBHOOK_ENV }).request("/telegram/webhook", {
      method: "POST",
      headers: webhookHeaders(),
      body,
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  test("отклоняет завышенный Content-Length единым JSON 413", async () => {
    const request = new Request("http://localhost/telegram/webhook", {
      method: "POST",
      headers: webhookHeaders({ "Content-Length": String(JSON_BODY_LIMIT_BYTES + 1) }),
      body: "{}",
    });

    const response = await createApp({ env: WEBHOOK_ENV }).fetch(request);

    expect(response.status).toBe(413);
    const responseBody = await response.json() as Record<string, unknown>;
    expect(responseBody).toMatchObject(BODY_LIMIT_ERROR);
    expect(responseBody.requestId).toBe(response.headers.get("X-Request-ID"));
  });

  test("отклоняет stream больше 256 KiB без Content-Length тем же JSON 413", async () => {
    const firstChunk = new Uint8Array(JSON_BODY_LIMIT_BYTES);
    const overflowChunk = new Uint8Array([1]);
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(firstChunk);
        controller.enqueue(overflowChunk);
        controller.close();
      },
    });
    const request = new Request("http://localhost/telegram/webhook", {
      method: "POST",
      headers: webhookHeaders(),
      body,
    });
    expect(request.headers.get("Content-Length")).toBeNull();

    const response = await createApp({ env: WEBHOOK_ENV }).fetch(request);

    expect(response.status).toBe(413);
    const responseBody = await response.json() as Record<string, unknown>;
    expect(responseBody).toMatchObject(BODY_LIMIT_ERROR);
    expect(responseBody.requestId).toBe(response.headers.get("X-Request-ID"));
  });

  test("сохраняет существующее поведение malformed JSON в пределах лимита", async () => {
    const response = await createApp({ env: WEBHOOK_ENV }).request("/telegram/webhook", {
      method: "POST",
      headers: webhookHeaders(),
      body: "not-json",
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });
});

describe("Retry-After для HttpError 429", () => {
  function appThrowing(details: Record<string, unknown>) {
    const app = createApp();
    app.get("/__test/retry-after", () => {
      throw new HttpError(429, "Слишком много запросов", details);
    });
    return app;
  }

  test("добавляет Retry-After и сохраняет retryAfterSeconds в JSON", async () => {
    const response = await appThrowing({ retryAfterSeconds: 60 }).request("/__test/retry-after");

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("60");
    expect(await response.json()).toMatchObject({
      error: "Слишком много запросов",
      code: "RATE_LIMITED",
      retryAfterSeconds: 60,
    });
    expect(response.headers.get("X-Request-ID")).toBeTruthy();
  });

  test.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "60"])(
    "не создаёт некорректный Retry-After для %p",
    async (retryAfterSeconds) => {
      const response = await appThrowing({ retryAfterSeconds }).request("/__test/retry-after");

      expect(response.status).toBe(429);
      expect(response.headers.has("Retry-After")).toBe(false);
    },
  );
});

describe("безопасный ответ на ZodError", () => {
  test("не содержит issues, деталей схемы или stack trace", async () => {
    const app = createApp();
    app.get("/__test/zod-error", () => {
      z.object({ field: z.string() }).parse({ field: 123 });
    });

    const response = await app.request("/__test/zod-error");
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(400);
    expect(body).toMatchObject({ error: "Проверьте корректность данных", code: "VALIDATION_ERROR" });
    expect(body.requestId).toBe(response.headers.get("X-Request-ID"));
    expect(body).not.toHaveProperty("issues");
    expect(body).not.toHaveProperty("stack");
    expect(JSON.stringify(body)).not.toContain("field");
  });
});

describe("безопасная классификация необработанных ошибок", () => {
  test("сетевой сбой возвращается как retryable 503", async () => {
    const app = createApp();
    app.get("/__test/connection-error", () => {
      throw Object.assign(new Error("connection closed"), { code: "CONNECTION_CLOSED" });
    });

    const response = await app.request("/__test/connection-error");
    const body = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(503);
    expect(body).toMatchObject({
      error: "Сервис временно недоступен. Попробуйте ещё раз",
      code: "DB_TEMPORARILY_UNAVAILABLE",
      retryable: true,
    });
    expect(body.requestId).toBe(response.headers.get("X-Request-ID"));
  });

  test("неизвестный сбой остаётся 500 с requestId", async () => {
    const app = createApp();
    app.get("/__test/program-error", () => {
      throw new Error("programming error");
    });

    const response = await app.request("/__test/program-error");
    const body = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(500);
    expect(body).toMatchObject({ error: "Внутренняя ошибка сервера", code: "INTERNAL_ERROR" });
    expect(body.requestId).toBe(response.headers.get("X-Request-ID"));
    expect(body).not.toHaveProperty("message");
  });

  test("не пишет raw exception message в production-лог", async () => {
    const errorLog = spyOn(console, "error").mockImplementation(() => {});
    try {
      const app = createApp();
      app.get("/__test/secret-error", () => {
        throw new Error("database password=super-secret token=do-not-log");
      });

      await app.request("/__test/secret-error");

      expect(JSON.stringify(errorLog.mock.calls)).not.toContain("super-secret");
      expect(JSON.stringify(errorLog.mock.calls)).not.toContain("do-not-log");
      expect(JSON.stringify(errorLog.mock.calls)).toContain("INTERNAL_ERROR");
    } finally {
      errorLog.mockRestore();
    }
  });
});
