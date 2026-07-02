import { describe, expect, test } from "bun:test";
import type { AppEnv } from "../src/env";
import { publicImageUrl } from "../src/lib/storage";

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
