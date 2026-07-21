import { describe, expect, test } from "bun:test";
import { createApp } from "../src/app";
import type { AppEnv } from "../src/env";

const PROD_ORIGIN = "https://agromarketkz-webapp.pages.dev";
const ENV: Partial<AppEnv> = { WEBAPP_ORIGIN: PROD_ORIGIN };

describe("production CORS", () => {
  test("production origin получает Access-Control-Allow-Origin", async () => {
    const response = await createApp({ env: ENV }).request("/health", {
      headers: { Origin: PROD_ORIGIN },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(PROD_ORIGIN);
  });

  test("произвольный origin не получает Access-Control-Allow-Origin", async () => {
    const response = await createApp({ env: ENV }).request("/health", {
      headers: { Origin: "https://evil.example" },
    });

    expect(response.status).toBe(200);
    expect(response.headers.has("Access-Control-Allow-Origin")).toBe(false);
  });

  test("preflight с production origin работает", async () => {
    const response = await createApp({ env: ENV }).request("/health", {
      method: "OPTIONS",
      headers: {
        Origin: PROD_ORIGIN,
        "Access-Control-Request-Method": "GET",
      },
    });

    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(PROD_ORIGIN);
    expect(response.headers.get("Access-Control-Allow-Methods")).toContain("GET");
  });

  test("preflight с произвольным origin отвечает без Access-Control-Allow-Origin", async () => {
    const response = await createApp({ env: ENV }).request("/health", {
      method: "OPTIONS",
      headers: {
        Origin: "https://evil.example",
        "Access-Control-Request-Method": "GET",
      },
    });

    expect(response.status).toBe(204);
    expect(response.headers.has("Access-Control-Allow-Origin")).toBe(false);
  });

  test("запрос без Origin (server-to-server) продолжает работать", async () => {
    const response = await createApp({ env: ENV }).request("/health");

    expect(response.status).toBe(200);
    expect(response.headers.has("Access-Control-Allow-Origin")).toBe(false);
    expect(await response.json()).toEqual({ status: "ok", app: "backend" });
  });
});
