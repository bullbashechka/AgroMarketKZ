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

export interface RequestOptions {
  /** Profile bootstrap owns its 401 transition and must not invalidate itself. */
  notifyUnauthorized?: boolean;
}

interface ResponseSchema<T> {
  safeParse(input: unknown): { success: true; data: T } | { success: false };
}

function apiErrorData(payload: unknown): {
  error?: string;
  retryAfterSeconds?: number;
  code?: string;
  requestId?: string;
  retryable?: boolean;
} {
  if (!payload || typeof payload !== "object") return {};
  const data = payload as Record<string, unknown>;
  return {
    error: typeof data.error === "string" ? data.error : undefined,
    retryAfterSeconds: typeof data.retryAfterSeconds === "number"
      && Number.isFinite(data.retryAfterSeconds)
      && data.retryAfterSeconds > 0
      ? data.retryAfterSeconds
      : undefined,
    code: typeof data.code === "string" ? data.code : undefined,
    requestId: typeof data.requestId === "string" ? data.requestId : undefined,
    retryable: data.retryable === true,
  };
}

async function request(
  method: string,
  path: string,
  body?: unknown,
  options: RequestOptions = {},
): Promise<unknown> {
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
    if (options.notifyUnauthorized !== false) handleUnauthorized();
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
    const data = apiErrorData(payload);
    throw new ApiError(
      response.status,
      data.error ?? "Не удалось выполнить запрос",
      data.retryAfterSeconds,
      data.code,
      data.requestId
        ?? response.headers.get("X-Request-ID")
        ?? undefined,
      data.retryable === true,
    );
  }

  return payload;
}

function parseResponse<T>(payload: unknown, schema: ResponseSchema<T>): T {
  const parsed = schema.safeParse(payload);
  if (parsed.success) return parsed.data;
  throw new ApiError(502, "Сервер вернул некорректные данные. Повторите попытку позже.", undefined, "INVALID_API_RESPONSE");
}

/** Runtime-validated response for critical API boundaries. */
export async function apiGetParsed<T>(path: string, schema: ResponseSchema<T>, options?: RequestOptions): Promise<T> {
  return parseResponse(await request("GET", path, undefined, options), schema);
}

/** Runtime-validated mutation response for critical API boundaries. */
export async function apiPostParsed<T>(path: string, body: unknown, schema: ResponseSchema<T>): Promise<T> {
  return parseResponse(await request("POST", path, body), schema);
}

export async function apiPutParsed<T>(path: string, body: unknown, schema: ResponseSchema<T>): Promise<T> {
  return parseResponse(await request("PUT", path, body), schema);
}

export const apiGet = <T>(path: string, options?: RequestOptions) => request("GET", path, undefined, options) as Promise<T>;
export const apiPost = <T>(path: string, body?: unknown) => request("POST", path, body) as Promise<T>;
export const apiPut = <T>(path: string, body?: unknown) => request("PUT", path, body) as Promise<T>;
export const apiPatch = <T>(path: string, body?: unknown) => request("PATCH", path, body) as Promise<T>;
export const apiDelete = <T = null>(path: string, body?: unknown) => request("DELETE", path, body) as Promise<T>;
