/** Повторяет HMAC-цепочку backend/src/lib/telegram.ts:validateInitData, чтобы подписывать initData офлайн в тестах. */

export interface TgUserPayload {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
}

export interface TelegramSession {
  /** Cookie header value in the form `name=value`; never expose it in reports. */
  cookie: string;
  profile: unknown;
}

const encoder = new TextEncoder();

async function hmac(key: BufferSource, message: string): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(message));
  return new Uint8Array(sig);
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function signInitData(botToken: string, user: TgUserPayload): Promise<string> {
  const params = new URLSearchParams();
  params.set("auth_date", String(Math.floor(Date.now() / 1000)));
  params.set("query_id", `AAE_e2e_${user.id}`);
  params.set("user", JSON.stringify(user));

  const dataCheckString = [...params.entries()]
    .filter(([key]) => key !== "hash")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  const secretKey = await hmac(encoder.encode("WebAppData"), botToken);
  const hash = toHex(await hmac(secretKey, dataCheckString));
  params.set("hash", hash);
  return params.toString();
}

/** Ретрай на транзиентные 5xx — общий dev-Supabase иногда отвечает не сразу под нагрузкой E2E. */
export async function loginAsTelegramUser(
  apiUrl: string,
  botToken: string,
  user: TgUserPayload,
  attempt = 1
): Promise<TelegramSession> {
  const initData = await signInitData(botToken, user);
  const res = await fetch(`${apiUrl}/auth/telegram`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ initData })
  });
  if (!res.ok) {
    if (res.status >= 500 && attempt < 3) {
      await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
      return loginAsTelegramUser(apiUrl, botToken, user, attempt + 1);
    }
    throw new Error(`login failed: ${res.status} ${await res.text()}`);
  }
  const setCookie = res.headers.get("set-cookie");
  if (!setCookie) {
    throw new Error("login failed: response did not set a session cookie");
  }
  const cookie = setCookie.split(";", 1)[0];
  if (!cookie?.includes("=")) {
    throw new Error("login failed: response set an invalid session cookie");
  }
  return {
    cookie,
    profile: await res.json(),
  };
}
