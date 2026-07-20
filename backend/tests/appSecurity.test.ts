import { describe, expect, test } from "bun:test";
import { createApp } from "../src/app";
import type { AppEnv } from "../src/env";
import { HttpError } from "../src/lib/errors";

const JSON_BODY_LIMIT_BYTES = 256 * 1024;
const BODY_LIMIT_ERROR = { error: "Размер запроса превышает 256 KiB" };
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
    expect(await response.json()).toEqual(BODY_LIMIT_ERROR);
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
    expect(await response.json()).toEqual(BODY_LIMIT_ERROR);
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
    expect(await response.json()).toEqual({
      error: "Слишком много запросов",
      retryAfterSeconds: 60,
    });
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
