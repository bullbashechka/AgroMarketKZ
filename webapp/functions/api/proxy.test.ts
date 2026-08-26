import { describe, expect, test } from "bun:test";
import { handleProxyRequest } from "./[[path]].js";

const baseEnv = {
  BACKEND_ORIGIN: "https://backend.example",
  PAGES_PROXY_SECRET: "pages-proxy-secret",
};

function context(path: string, init: RequestInit = {}, env = baseEnv) {
  return {
    request: new Request(`https://app.example${path}`, init),
    env,
  };
}

describe("Pages API proxy contract", () => {
  test("forwards a same-origin JSON mutation with path, query, cookie and trusted protocol headers", async () => {
    let forwardedUrl = "";
    let forwardedInit: RequestInit | undefined;
    const response = await handleProxyRequest(
      context("/api/catalog?category=grain", {
        method: "POST",
        headers: {
          Origin: "https://app.example",
          "Content-Type": "application/json; charset=utf-8",
          Cookie: "session=abc",
        },
        body: JSON.stringify({ title: "Пшеница" }),
      }),
      async (url, init) => {
        forwardedUrl = String(url);
        forwardedInit = init;
        return new Response("upstream", { status: 201 });
      },
    );

    expect(response.status).toBe(201);
    expect(forwardedUrl).toBe("https://backend.example/catalog?category=grain");
    expect(forwardedInit?.method).toBe("POST");
    expect(new Headers(forwardedInit?.headers).get("Cookie")).toBe("session=abc");
    expect(new Headers(forwardedInit?.headers).get("X-Agromarket-Proxy")).toBe(baseEnv.PAGES_PROXY_SECRET);
    expect(new Headers(forwardedInit?.headers).get("X-Forwarded-Origin")).toBe("https://app.example");
    expect(new Headers(forwardedInit?.headers).get("X-Agromarket-Proxy-Version")).toBe("1");
    expect(await new Response(forwardedInit?.body).text()).toBe(JSON.stringify({ title: "Пшеница" }));
  });

  test("fails closed for missing configuration", async () => {
    let called = false;
    const response = await handleProxyRequest(
      context("/api/catalog", { method: "GET" }, { BACKEND_ORIGIN: "", PAGES_PROXY_SECRET: "" }),
      async () => {
        called = true;
        return new Response();
      },
    );

    expect(response.status).toBe(503);
    expect(called).toBe(false);
    expect(await response.json()).toMatchObject({ code: "PROXY_CONFIGURATION_INVALID" });
  });

  test("rejects missing or cross-origin Origin and non-JSON mutations", async () => {
    const cases = [
      context("/api/catalog", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }),
      context("/api/catalog", { method: "POST", headers: { Origin: "https://evil.example", "Content-Type": "application/json" }, body: "{}" }),
      context("/api/catalog", { method: "PATCH", headers: { Origin: "https://app.example", "Content-Type": "text/plain" }, body: "x" }),
    ];

    for (const value of cases) {
      const response = await handleProxyRequest(value, async () => {
        throw new Error("must not forward rejected request");
      });
      expect([403, 415]).toContain(response.status);
    }
  });

  test("rejects client-supplied internal headers instead of overwriting them", async () => {
    for (const header of ["X-Agromarket-Proxy", "X-Forwarded-Origin", "X-Agromarket-Proxy-Version"]) {
      const response = await handleProxyRequest(
        context("/api/catalog", { method: "GET", headers: { [header]: "forged" } }),
        async () => {
          throw new Error("must not forward forged internal headers");
        },
      );
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ code: "PROXY_INTERNAL_HEADER_FORBIDDEN" });
    }
  });
});
