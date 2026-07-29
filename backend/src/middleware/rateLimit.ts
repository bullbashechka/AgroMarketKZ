import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import { getEnv, type HonoEnv } from "../env";
import { HttpError } from "../lib/errors";
import { isPlausibleTelegramId } from "../lib/telegramId";

const RETRY_AFTER_SECONDS = 60;

export function authenticatedRouteGroup(path: string): string {
  const pathname = path.split("?", 1)[0] ?? "";
  const [firstSegment, secondSegment] = pathname.split("/").filter(Boolean);

  if (firstSegment === "admin") {
    return `admin:${secondSegment ?? "root"}`;
  }

  return firstSegment ?? "root";
}

/** Вызывается только после того, как requireAuth установил пользователя в контексте. */
export async function enforceAuthenticatedRateLimit(c: Context<HonoEnv>): Promise<void> {
  const { userId } = c.get("auth");
  const isSafeRead = c.req.method === "GET" || c.req.method === "HEAD";
  const env = getEnv(c);
  const limiter = isSafeRead ? env.API_READ_RATE_LIMITER : env.API_MUTATION_RATE_LIMITER;

  if (!limiter) return;

  const key = isSafeRead ? userId : `${userId}:${authenticatedRouteGroup(c.req.path)}`;
  const { success } = await limiter.limit({ key });

  if (!success) {
    throw new HttpError(429, "Слишком много запросов", {
      retryAfterSeconds: RETRY_AFTER_SECONDS,
    });
  }
}

/**
 * Telegram id из тела запроса ДО проверки подписи — исключительно как ключ лимитера.
 * Значение не доверенное и не является границей безопасности; объём держит IP-потолок.
 */
export async function extractLoginTelegramId(c: Context<HonoEnv>): Promise<number | null> {
  if (c.req.method !== "POST") return null;

  try {
    const body: unknown = await c.req.json().catch(() => null);
    if (typeof body !== "object" || body === null) return null;

    if ("initData" in body && typeof body.initData === "string") {
      const userRaw = new URLSearchParams(body.initData).get("user");
      if (!userRaw) return null;
      const user: unknown = JSON.parse(userRaw);
      if (typeof user !== "object" || user === null || !("id" in user)) return null;
      return isPlausibleTelegramId(user.id) ? user.id : null;
    }

    if (!("id" in body)) return null;
    return isPlausibleTelegramId(body.id) ? body.id : null;
  } catch {
    return null;
  }
}

/** Два независимых pre-auth лимитера для `/auth/*`; без bindings локально являются no-op. */
export const enforceAuthRateLimit = createMiddleware<HonoEnv>(async (c, next) => {
  const env = getEnv(c);
  const ip = c.req.header("CF-Connecting-IP") ?? "unknown";

  if (env.AUTH_RATE_LIMITER) {
    const { success } = await env.AUTH_RATE_LIMITER.limit({ key: ip });

    if (!success) {
      throw new HttpError(429, "Слишком много запросов", {
        retryAfterSeconds: RETRY_AFTER_SECONDS,
      });
    }
  }

  if (env.AUTH_IDENTITY_RATE_LIMITER) {
    const telegramId = await extractLoginTelegramId(c);
    if (telegramId !== null) {
      const { success } = await env.AUTH_IDENTITY_RATE_LIMITER.limit({
        key: `${ip}:${telegramId}`,
      });

      if (!success) {
        throw new HttpError(429, "Слишком много запросов", {
          retryAfterSeconds: RETRY_AFTER_SECONDS,
        });
      }
    }
  }

  await next();
});
