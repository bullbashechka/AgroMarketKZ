// Production and preview traffic always traverses the same-origin Pages proxy.
// The Vite dev server mirrors that path, so browser code never needs a Worker origin.
const apiUrl = "/api";
let unauthorizedHandler: (() => Promise<void> | void) | undefined;
let unauthorizedRecovery: Promise<void> | undefined;

/** Регистрирует единый recovery сессии, чтобы параллельные 401 не запускали несколько повторных входов. */
export function setUnauthorizedHandler(handler: (() => Promise<void> | void) | undefined): void {
  unauthorizedHandler = handler;
}

function handleUnauthorized(): void {
  if (!unauthorizedHandler || unauthorizedRecovery) return;
  const handler = unauthorizedHandler;
  unauthorizedRecovery = Promise.resolve()
    .then(() => handler())
    .finally(() => {
      unauthorizedRecovery = undefined;
    });
}

/** Ошибка ответа backend с HTTP-статусом и сообщением. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly retryAfterSeconds?: number,
    public readonly code?: string,
    public readonly requestId?: string,
    public readonly retryable = false,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function isAmbiguousMutationError(error: unknown): boolean {
  return !(error instanceof ApiError)
    || error.retryable
    || error.status >= 500;
}

export function formatApiError(error: unknown, fallback: string): string {
  if (!(error instanceof ApiError)) return fallback;
  if (!error.requestId || error.status < 500) return error.message;
  return `${error.message} (код обращения: ${error.requestId})`;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";

  const response = await fetch(`${apiUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: "include",
  });

  if (response.status === 401) {
    // Токен недействителен/истёк — сбрасываем сессию (в браузере → к Login Widget).
    handleUnauthorized();
    throw new ApiError(
      401,
      "Сессия истекла",
      undefined,
      "SESSION_EXPIRED",
      response.headers.get("X-Request-ID") ?? undefined,
    );
  }

  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const message =
      (payload as { error?: string } | null)?.error ?? "Не удалось выполнить запрос";
    throw new ApiError(
      response.status,
      message,
      (payload as { retryAfterSeconds?: number } | null)?.retryAfterSeconds,
      (payload as { code?: string } | null)?.code,
      (payload as { requestId?: string } | null)?.requestId
        ?? response.headers.get("X-Request-ID")
        ?? undefined,
      (payload as { retryable?: boolean } | null)?.retryable === true,
    );
  }

  return payload as T;
}

export const apiGet = <T>(path: string) => request<T>("GET", path);
export const apiPost = <T>(path: string, body?: unknown) => request<T>("POST", path, body);
export const apiPut = <T>(path: string, body?: unknown) => request<T>("PUT", path, body);
export const apiPatch = <T>(path: string, body?: unknown) => request<T>("PATCH", path, body);
export const apiDelete = <T = null>(path: string, body?: unknown) => request<T>("DELETE", path, body);
