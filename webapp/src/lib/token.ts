const TOKEN_KEY = "agromarket.jwt";

/** Хранение JWT в localStorage; серверский срок действия токена — 24 часа. */
export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string): void {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* localStorage недоступен — работаем без персистентности сессии */
  }
}

export function clearToken(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* no-op */
  }
}
