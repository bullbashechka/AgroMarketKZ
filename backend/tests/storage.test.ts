import { describe, expect, test } from "bun:test";
import type { AppEnv } from "../src/env";
import {
  buildCardImagePath,
  extFromContentType,
  publicImageUrl,
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
