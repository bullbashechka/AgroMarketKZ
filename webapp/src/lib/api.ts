import { clearToken, getToken } from "./token";

const apiUrl = (import.meta.env.VITE_API_URL ?? "http://localhost:3000").replace(/\/$/, "");
let unauthorizedHandler: (() => Promise<void> | void) | undefined;
let unauthorizedRecovery: Promise<void> | undefined;

/** Регистрирует единый recovery сессии, чтобы параллельные 401 не запускали несколько повторных входов. */
export function setUnauthorizedHandler(handler: (() => Promise<void> | void) | undefined): void {
  unauthorizedHandler = handler;
}

function handleUnauthorized(): void {
  clearToken();
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
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const response = await fetch(`${apiUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });

  if (response.status === 401) {
    // Токен недействителен/истёк — сбрасываем сессию (в браузере → к Login Widget).
    handleUnauthorized();
    throw new ApiError(401, "Сессия истекла");
  }

  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const message =
      (payload as { error?: string } | null)?.error ?? "Не удалось выполнить запрос";
    throw new ApiError(
      response.status,
      message,
      (payload as { retryAfterSeconds?: number } | null)?.retryAfterSeconds,
    );
  }

  return payload as T;
}

export const apiGet = <T>(path: string) => request<T>("GET", path);
export const apiPost = <T>(path: string, body?: unknown) => request<T>("POST", path, body);
export const apiPut = <T>(path: string, body?: unknown) => request<T>("PUT", path, body);
export const apiPatch = <T>(path: string, body?: unknown) => request<T>("PATCH", path, body);
export const apiDelete = <T = null>(path: string) => request<T>("DELETE", path);
