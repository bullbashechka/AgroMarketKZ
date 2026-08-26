const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const INTERNAL_HEADERS = [
  "X-Agromarket-Proxy",
  "X-Forwarded-Origin",
  "X-Agromarket-Proxy-Version",
];
const PROXY_PROTOCOL_VERSION = "1";

function policyError(error, code, status) {
  return Response.json({ error, code }, { status });
}

function hasClientSuppliedInternalHeaders(headers) {
  return INTERNAL_HEADERS.some((header) => headers.has(header));
}

function upstreamUrl(requestUrl, backendOrigin) {
  if (!backendOrigin) return undefined;
  try {
    const origin = new URL(backendOrigin);
    if (origin.protocol !== "http:" && origin.protocol !== "https:") return undefined;
    return new URL(requestUrl.pathname.replace(/^\/api/, "") + requestUrl.search, origin);
  } catch {
    return undefined;
  }
}

/**
 * Builds the trusted Pages-to-Worker request without performing network I/O.
 * It is intentionally small so the production boundary has direct contract
 * coverage without introducing another proxy abstraction.
 */
export function buildProxyRequest(context) {
  const requestUrl = new URL(context.request.url);
  const upstream = upstreamUrl(requestUrl, context.env.BACKEND_ORIGIN);
  if (!upstream || !context.env.PAGES_PROXY_SECRET) {
    return policyError("Proxy не настроен", "PROXY_CONFIGURATION_INVALID", 503);
  }
  if (hasClientSuppliedInternalHeaders(context.request.headers)) {
    return policyError("Внутренние proxy-заголовки запрещены", "PROXY_INTERNAL_HEADER_FORBIDDEN", 403);
  }

  const isWebhook = upstream.pathname === "/telegram/webhook";
  if (MUTATING_METHODS.has(context.request.method) && !isWebhook) {
    const origin = context.request.headers.get("Origin");
    if (origin !== requestUrl.origin) {
      return policyError("Недопустимый Origin", "CSRF_ORIGIN_INVALID", 403);
    }
    if (!context.request.headers.get("Content-Type")?.startsWith("application/json")) {
      return policyError("Ожидается JSON-запрос", "CSRF_CONTENT_TYPE_INVALID", 415);
    }
  }

  const headers = new Headers(context.request.headers);
  headers.delete("Host");
  headers.set("X-Agromarket-Proxy", context.env.PAGES_PROXY_SECRET);
  headers.set("X-Forwarded-Origin", requestUrl.origin);
  headers.set("X-Agromarket-Proxy-Version", PROXY_PROTOCOL_VERSION);

  return {
    upstream,
    init: {
      method: context.request.method,
      headers,
      body: MUTATING_METHODS.has(context.request.method) ? context.request.body : undefined,
      redirect: "manual",
    },
  };
}

export async function handleProxyRequest(context, fetchImpl = fetch) {
  const forward = buildProxyRequest(context);
  if (forward instanceof Response) return forward;
  return fetchImpl(forward.upstream, forward.init);
}

/**
 * Same-origin boundary for the static Pages app. Cookies are issued against
 * the Pages host, and the Worker accepts production app traffic only when this
 * secret is present. Telegram's independently authenticated webhook bypasses
 * the browser-origin check.
 */
export async function onRequest(context) {
  return handleProxyRequest(context);
}
