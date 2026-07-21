import type { Context } from "hono";
import { getEnv, type HonoEnv } from "../env";
import { HttpError } from "../lib/errors";

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
