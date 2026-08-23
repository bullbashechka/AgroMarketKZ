import { API_URL } from "./env";

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
    throw new Error(`${method} ${path} failed: ${res.status} ${await res.text()}`);
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

export const E2E_PREFIX = "[e2e]";

export interface AdminCategory {
  id: string;
  name: string;
  type: "service" | "product";
  cardCount: number;
  activeCardCount: number;
}

export interface AdminCardListItem {
  id: string;
  title: string;
  categoryId: string;
}

export async function createTestCategory(token: string, type: "service" | "product") {
  return api.post<{ id: string; name: string }>("/admin/categories", token, {
    type,
    name: `${E2E_PREFIX} Категория ${Date.now()}`,
    sortOrder: 999
  });
}

export async function deleteTestCategory(token: string, id: string) {
  await api.delete(`/admin/categories/${id}`, token).catch(() => {});
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

export async function deleteTestCard(token: string, id: string) {
  const card = await api.get<{ version: number }>(`/admin/cards/${id}`, token).catch(() => undefined);
  if (!card) return;
  await api.delete(`/admin/cards/${id}`, token, { expectedVersion: card.version }).catch(() => {});
}

export async function sweepE2eLeftovers(adminToken: string) {
  for (const type of ["service", "product"] as const) {
    const cards = await api.get<{ items: AdminCardListItem[] }>(
      `/admin/cards?type=${type}&limit=100`,
      adminToken
    );
    for (const card of cards.items ?? []) {
      if (card.title.startsWith(E2E_PREFIX)) {
        await deleteTestCard(adminToken, card.id);
      }
    }
    const categories = await api.get<AdminCategory[]>(`/admin/categories?type=${type}`, adminToken);
    for (const category of categories ?? []) {
      if (category.name.startsWith(E2E_PREFIX) && category.cardCount === 0) {
        await deleteTestCategory(adminToken, category.id);
      }
    }
  }
}
