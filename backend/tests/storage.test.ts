import { afterEach, describe, expect, test } from "bun:test";
import type { AppEnv } from "../src/env";
import {
  buildCardImagePath,
  createSignedUploadUrl,
  extFromContentType,
  publicImageUrl,
  readBoundedStorageJson,
  signedUploadUrlFromResponse
} from "../src/lib/storage";

const env = {
  SUPABASE_URL: "https://qxyieyzfdcosmmckyocm.supabase.co",
  SUPABASE_STORAGE_BUCKET: "card-images"
} as AppEnv;

describe("publicImageUrl", () => {
  test("собирает публичный URL из storage_path", () => {
    expect(publicImageUrl(env, "cards/abc/1.jpg")).toBe(
      "https://qxyieyzfdcosmmckyocm.supabase.co/storage/v1/object/public/card-images/cards/abc/1.jpg"
    );
  });

  test("не дублирует слэш, если SUPABASE_URL заканчивается на /", () => {
    const trailing = { ...env, SUPABASE_URL: "https://qxyieyzfdcosmmckyocm.supabase.co/" } as AppEnv;
    expect(publicImageUrl(trailing, "cards/abc/1.jpg")).toBe(
      "https://qxyieyzfdcosmmckyocm.supabase.co/storage/v1/object/public/card-images/cards/abc/1.jpg"
    );
  });

  test("не дублирует слэш, если storagePath начинается с /", () => {
    expect(publicImageUrl(env, "/cards/abc/1.jpg")).toBe(
      "https://qxyieyzfdcosmmckyocm.supabase.co/storage/v1/object/public/card-images/cards/abc/1.jpg"
    );
  });
});

describe("extFromContentType", () => {
  test("сопоставляет MIME-тип и расширение", () => {
    expect(extFromContentType("image/jpeg")).toBe("jpg");
    expect(extFromContentType("image/png")).toBe("png");
    expect(extFromContentType("image/webp")).toBe("webp");
  });
});

describe("buildCardImagePath", () => {
  test("строит путь вида cards/{id}.{ext}", () => {
    expect(buildCardImagePath("image/webp", "11111111-1111-4111-8111-111111111111")).toBe(
      "cards/11111111-1111-4111-8111-111111111111.webp"
    );
  });

  test("строит run-scoped путь для E2E и отклоняет небезопасный идентификатор", () => {
    expect(buildCardImagePath("image/webp", "11111111-1111-4111-8111-111111111111", "run-1")).toBe(
      "e2e/run-1/11111111-1111-4111-8111-111111111111.webp"
    );
    expect(() => buildCardImagePath("image/webp", "11111111-1111-4111-8111-111111111111", "run_under")).toThrow();
  });
});

describe("signedUploadUrlFromResponse", () => {
  test("собирает абсолютный URL и извлекает token", () => {
    const result = signedUploadUrlFromResponse(env, {
      url: "/object/upload/sign/card-images/cards/a.jpg?token=abc123"
    });
    expect(result.uploadUrl).toBe(
      "https://qxyieyzfdcosmmckyocm.supabase.co/storage/v1/object/upload/sign/card-images/cards/a.jpg?token=abc123"
    );
    expect(result.token).toBe("abc123");
  });

  test("бросает HttpError, если в ответе нет token", () => {
    expect(() =>
      signedUploadUrlFromResponse(env, { url: "/object/upload/sign/card-images/cards/a.jpg" })
    ).toThrow();
  });
});

describe("Storage outbound boundary", () => {
  const realFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  test("sets a timeout for server-side Storage fetches", async () => {
    let signal: AbortSignal | undefined;
    globalThis.fetch = (async (_input, init) => {
      signal = init?.signal as AbortSignal | undefined;
      return new Response(JSON.stringify({ url: "/object/upload/sign/card-images/cards/a.jpg?token=abc" }));
    }) as typeof fetch;

    await createSignedUploadUrl({ ...env, SUPABASE_SERVICE_ROLE_KEY: "service-key" } as AppEnv, "cards/a.jpg");
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal?.aborted).toBeFalse();
  });

  test("rejects malformed and oversized Storage JSON without reading an unbounded body", async () => {
    await expect(readBoundedStorageJson(new Response("not-json"))).rejects.toThrow("некорректный ответ");
    await expect(
      readBoundedStorageJson(new Response("{}", { headers: { "content-length": String(256 * 1024 + 1) } }))
    ).rejects.toThrow("слишком большой");
  });

  test("rejects a valid JSON payload with an invalid Storage shape", async () => {
    globalThis.fetch = (async () => new Response("{}")) as typeof fetch;

    await expect(
      createSignedUploadUrl({ ...env, SUPABASE_SERVICE_ROLE_KEY: "service-key" } as AppEnv, "cards/a.jpg")
    ).rejects.toThrow("некорректный ответ");
  });
});
