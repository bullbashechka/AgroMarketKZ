import { API_URL } from "./env";

class E2EApiError extends Error {
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

async function request<T>(method: string, path: string, token: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`
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
  get: <T>(path: string, token: string) => request<T>("GET", path, token),
  post: <T>(path: string, token: string, body?: unknown) => request<T>("POST", path, token, body),
  put: <T>(path: string, token: string, body?: unknown) => request<T>("PUT", path, token, body),
  patch: <T>(path: string, token: string, body?: unknown) => request<T>("PATCH", path, token, body),
  delete: <T>(path: string, token: string, body?: unknown) => request<T>("DELETE", path, token, body)
};

export const E2E_PREFIX = `[e2e:${process.env.E2E_RUN_ID ?? "unconfigured"}]`;

export async function createTestCategory(token: string, type: "service" | "product") {
  return api.post<{ id: string; name: string }>("/admin/categories", token, {
    type,
    name: `${E2E_PREFIX} Категория ${Date.now()}`,
    sortOrder: 999
  });
}

export async function createTestCard(
  token: string,
  categoryId: string,
  type: "service" | "product",
  overrides: Partial<Record<string, unknown>> = {}
) {
  return api.post<{ id: string; title: string }>("/admin/cards", token, {
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
