import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { AppEnv } from "../src/env";

type FakeRow = Record<string, unknown>;

/**
 * Фейковый postgres.js `sql` — распознаёт три запроса repos/users.ts по характерным
 * фрагментам текста и возвращает заранее заданные строки. Не тестирует SQL сам по себе,
 * только то, что findAuthUserCached/revokeUserSessions/register вызывают правильный запрос
 * и правильно реагируют на его результат (в частности — инвалидацию KV-кеша).
 */
function createFakeSql(responses: { select?: FakeRow[]; revoke?: FakeRow[]; register?: FakeRow[] }) {
  const calls: string[] = [];
  const fn = (strings: TemplateStringsArray, ..._values: unknown[]) => {
    const text = strings.join("|");
    calls.push(text);
    if (text.includes("token_version, registered_at")) return Promise.resolve(responses.select ?? []);
    if (text.includes("token_version = token_version + 1")) return Promise.resolve(responses.revoke ?? []);
    if (text.includes("registered_at = coalesce")) return Promise.resolve(responses.register ?? []);
    throw new Error(`unexpected query in fake sql: ${text}`);
  };
  return Object.assign(fn, { calls });
}

let activeSql: ReturnType<typeof createFakeSql>;

// mock.module патчит модуль в реестре Bun на весь процесс (не только для этого файла), поэтому
// сохраняем остальные экспорты db.ts как есть — иначе сломался бы, например, tests/db.test.ts,
// который импортирует isConnectionError/withReconnect/POSTGRES_POOL_OPTIONS из того же модуля.
const realDb = await import("../src/db");
mock.module("../src/db", () => ({ ...realDb, getDb: () => activeSql }));

// Импорт после mock.module — модуль подменяется в реестре Bun ещё до первого использования.
const { findAuthUserCached, revokeUserSessions, register } = await import("../src/repos/users");

class KVMock {
  private readonly store = new Map<string, string>();
  readonly puts: Array<{ key: string; ttl?: number }> = [];
  readonly deletes: string[] = [];

  constructor(seed?: Record<string, unknown>) {
    for (const [key, value] of Object.entries(seed ?? {})) this.store.set(key, JSON.stringify(value));
  }
  async get<T>(key: string): Promise<T | null> {
    const raw = this.store.get(key);
    return raw === undefined ? null : (JSON.parse(raw) as T);
  }
  async put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void> {
    this.store.set(key, value);
    this.puts.push({ key, ttl: opts?.expirationTtl });
  }
  async delete(key: string): Promise<void> {
    this.store.delete(key);
    this.deletes.push(key);
  }
}

const USER_ID = "45d5fe54-f20b-4fe4-9e22-cad4f7751a47";
const TELEGRAM_ID = 777;
const CACHE_KEY = `authuser:v1:${USER_ID}`;

function envWith(kv?: KVMock): AppEnv {
  return { AUTH_CACHE_KV: kv } as unknown as AppEnv;
}

beforeEach(() => {
  // Гарантированно ломает любой запрос, который дошёл бы до "БД" в обход ожидаемой ветки —
  // тесты сами подставляют activeSql там, где ожидают реальный вызов.
  activeSql = createFakeSql({});
});

describe("findAuthUserCached", () => {
  test("отдаёт значение из KV, не трогая БД", async () => {
    const kv = new KVMock({ [CACHE_KEY]: { tokenVersion: 3, isRegistered: true } });
    activeSql = createFakeSql({
      select: [{ token_version: 999, registered_at: null }], // если вызовется — тест это поймает
    });

    const result = await findAuthUserCached(envWith(kv), USER_ID, TELEGRAM_ID);

    expect(result).toEqual({ tokenVersion: 3, isRegistered: true });
    expect(activeSql.calls).toEqual([]);
    expect(kv.puts).toEqual([]);
  });

  test("при промахе идёт в БД и заполняет кеш", async () => {
    const kv = new KVMock();
    activeSql = createFakeSql({ select: [{ token_version: 1, registered_at: new Date("2026-01-01") }] });

    const result = await findAuthUserCached(envWith(kv), USER_ID, TELEGRAM_ID);

    expect(result).toEqual({ tokenVersion: 1, isRegistered: true });
    expect(activeSql.calls.length).toBe(1);
    await Bun.sleep(0); // put() — fire-and-forget
    expect(kv.puts).toEqual([{ key: CACHE_KEY, ttl: 60 }]);
  });

  test("битая запись в кеше (не число/не boolean) считается промахом", async () => {
    const kv = new KVMock({ [CACHE_KEY]: { tokenVersion: "oops", isRegistered: true } });
    activeSql = createFakeSql({ select: [{ token_version: 5, registered_at: null }] });

    const result = await findAuthUserCached(envWith(kv), USER_ID, TELEGRAM_ID);

    expect(result).toEqual({ tokenVersion: 5, isRegistered: false });
    expect(activeSql.calls.length).toBe(1);
  });

  test("без AUTH_CACHE_KV деградирует к прямому SELECT", async () => {
    activeSql = createFakeSql({ select: [{ token_version: 7, registered_at: null }] });

    const result = await findAuthUserCached(envWith(undefined), USER_ID, TELEGRAM_ID);

    expect(result).toEqual({ tokenVersion: 7, isRegistered: false });
  });
});

describe("инвалидация кеша", () => {
  test("revokeUserSessions удаляет ключ при успешном отзыве", async () => {
    const kv = new KVMock({ [CACHE_KEY]: { tokenVersion: 0, isRegistered: true } });
    activeSql = createFakeSql({ revoke: [{ id: USER_ID }] });

    const revoked = await revokeUserSessions(envWith(kv), USER_ID);

    expect(revoked).toBe(true);
    expect(kv.deletes).toEqual([CACHE_KEY]);
  });

  test("revokeUserSessions не трогает кеш, если пользователь не найден", async () => {
    const kv = new KVMock({ [CACHE_KEY]: { tokenVersion: 0, isRegistered: true } });
    activeSql = createFakeSql({ revoke: [] });

    const revoked = await revokeUserSessions(envWith(kv), USER_ID);

    expect(revoked).toBe(false);
    expect(kv.deletes).toEqual([]);
  });

  test("register удаляет ключ, чтобы isRegistered не оставался устаревшим", async () => {
    const kv = new KVMock({ [CACHE_KEY]: { tokenVersion: 0, isRegistered: false } });
    activeSql = createFakeSql({
      register: [{ id: USER_ID, registered_at: new Date("2026-01-01") } as FakeRow],
    });

    await register(envWith(kv), USER_ID, { contactName: "Аскар", contactPhone: "+77001234567" });

    expect(kv.deletes).toEqual([CACHE_KEY]);
  });

  test("без AUTH_CACHE_KV инвалидация — no-op, не падает", async () => {
    activeSql = createFakeSql({ revoke: [{ id: USER_ID }] });
    await expect(revokeUserSessions(envWith(undefined), USER_ID)).resolves.toBe(true);
  });
});
