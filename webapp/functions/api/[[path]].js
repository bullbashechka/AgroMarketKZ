const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Same-origin boundary for the static Pages app. Cookies are issued against
 * the Pages host, and the Worker accepts production app traffic only when this
 * secret is present. Telegram's independently authenticated webhook bypasses
 * the browser-origin check.
 */
export async function onRequest(context) {
  const requestUrl = new URL(context.request.url);
  const upstream = new URL(requestUrl.pathname.replace(/^\/api/, "") + requestUrl.search, context.env.BACKEND_ORIGIN);
  const isWebhook = upstream.pathname === "/telegram/webhook";

  if (MUTATING_METHODS.has(context.request.method) && !isWebhook) {
    const origin = context.request.headers.get("Origin");
    if (origin !== requestUrl.origin) {
      return Response.json({ error: "Недопустимый Origin", code: "CSRF_ORIGIN_INVALID" }, { status: 403 });
    }
    if (!context.request.headers.get("Content-Type")?.startsWith("application/json")) {
      return Response.json({ error: "Ожидается JSON-запрос", code: "CSRF_CONTENT_TYPE_INVALID" }, { status: 415 });
    }
  }

  const headers = new Headers(context.request.headers);
  headers.delete("Host");
  headers.delete("X-Agromarket-Proxy");
  headers.set("X-Agromarket-Proxy", context.env.PAGES_PROXY_SECRET);
  headers.set("X-Forwarded-Origin", requestUrl.origin);

  return fetch(upstream, {
    method: context.request.method,
    headers,
    body: MUTATING_METHODS.has(context.request.method) ? context.request.body : undefined,
    redirect: "manual",
  });
}
