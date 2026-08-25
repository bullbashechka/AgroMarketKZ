import { API_URL } from "./env";

export class E2EApiError extends Error {
  constructor(
    public readonly method: string,
    public readonly path: string,
    public readonly status: number,
    body: string,
  ) {
    super(`${method} ${path} failed: ${status} ${body}`);
    this.name = "E2EApiError";
  }
}

async function request<T>(method: string, path: string, sessionCookie: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      cookie: sessionCookie,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  if (!res.ok) {
    throw new E2EApiError(method, path, res.status, await res.text());
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return text ? (JSON.parse(text) as T) : (undefined as T);
}

export const api = {
  get: <T>(path: string, sessionCookie: string) => request<T>("GET", path, sessionCookie),
  post: <T>(path: string, sessionCookie: string, body?: unknown) => request<T>("POST", path, sessionCookie, body),
  put: <T>(path: string, sessionCookie: string, body?: unknown) => request<T>("PUT", path, sessionCookie, body),
  patch: <T>(path: string, sessionCookie: string, body?: unknown) => request<T>("PATCH", path, sessionCookie, body),
  delete: <T>(path: string, sessionCookie: string, body?: unknown) => request<T>("DELETE", path, sessionCookie, body)
};

export const E2E_PREFIX = `[e2e:${process.env.E2E_RUN_ID ?? "unconfigured"}]`;

export async function createTestCategory(sessionCookie: string, type: "service" | "product") {
  return api.post<{ id: string; name: string }>("/admin/categories", sessionCookie, {
    type,
    name: `${E2E_PREFIX} Кат. ${Date.now()}`,
    sortOrder: 999
  });
}

export async function createTestCard(
  sessionCookie: string,
  categoryId: string,
  type: "service" | "product",
  overrides: Partial<Record<string, unknown>> = {}
) {
  return api.post<{ id: string; title: string }>("/admin/cards", sessionCookie, {
    type,
    categoryId,
    title: `${E2E_PREFIX} Карточка ${Date.now()}`,
    description: "Тестовое описание для E2E",
    sortOrder: 0,
    priceType: "fixed",
    priceAmount: 1000,
    images: [],
    specs: [],
    ...overrides
  });
}
