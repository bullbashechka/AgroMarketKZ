import { describe, expect, test } from "bun:test";
import {
  assertSafeE2EEnvironment,
  databaseIdentity,
  supabaseProjectIdentity,
  type E2ESafetyInput,
} from "./safety";

const safeConfig: E2ESafetyInput = {
  apiUrl: "http://127.0.0.1:3000",
  baseUrl: "http://127.0.0.1:5173",
  databaseUrl: "postgresql://test@127.0.0.1:55432/e2e",
  supabaseUrl: "https://e2e-project.supabase.co",
  storageBucket: "card-images-e2e",
  telegramBotToken: "e2e-bot-token",
  jwtSecret: "e2e-jwt-secret",
  storageServiceKey: "e2e-service-key",
  productionApiUrl: "https://agromarketkz-api.example",
  productionDatabaseUrl: "postgresql://production@pooler.supabase.com/prod",
  productionSupabaseUrl: "https://production.supabase.co",
  productionTelegramBotToken: "production-bot-token",
  productionJwtSecret: "production-jwt-secret",
  productionStorageServiceKey: "production-service-key",
};

describe("E2E environment safety", () => {
  test("accepts an isolated loopback configuration", () => {
    expect(() => assertSafeE2EEnvironment(safeConfig)).not.toThrow();
  });

  test.each([
    ["remote API", { apiUrl: "https://agromarketkz-api.example" }],
    ["production database", { databaseUrl: safeConfig.productionDatabaseUrl }],
    ["production Storage", { supabaseUrl: safeConfig.productionSupabaseUrl }],
    ["production bot token", { telegramBotToken: safeConfig.productionTelegramBotToken }],
  ])("rejects %s", (_label, override) => {
    expect(() => assertSafeE2EEnvironment({ ...safeConfig, ...override })).toThrow();
  });

  test("compares parsed Supabase project and pooler database identity", () => {
    expect(supabaseProjectIdentity("https://production.supabase.co/"))
      .toBe(supabaseProjectIdentity("https://PRODUCTION.supabase.co/rest/v1"));
    expect(databaseIdentity("postgresql://postgres.production@pooler.supabase.com:6543/postgres?sslmode=require"))
      .toMatchObject({ projectRef: "production", database: "postgres", port: 6543 });
    expect(() => assertSafeE2EEnvironment({
      ...safeConfig,
      databaseUrl: "postgresql://postgres.production@aws-0-test.pooler.supabase.com:5432/postgres?sslmode=require",
      productionDatabaseUrl: "postgresql://postgres.production@aws-1-prod.pooler.supabase.com:6543/postgres",
    })).toThrow("production database");
  });

  test("rejects a service key from the same Supabase project even after rotation", () => {
    const jwt = (ref: string, nonce: string) => `header.${Buffer.from(JSON.stringify({ ref, nonce })).toString("base64url")}.signature`;
    expect(() => assertSafeE2EEnvironment({
      ...safeConfig,
      storageServiceKey: jwt("production", "test-key"),
      productionStorageServiceKey: jwt("production", "rotated-prod-key"),
    })).toThrow("production key");
  });

  test("fails closed for remote E2E resources without a production baseline", () => {
    expect(() => assertSafeE2EEnvironment({
      ...safeConfig,
      databaseUrl: "postgresql://postgres.test@pooler.supabase.com:6543/postgres",
      supabaseUrl: "https://test-project.supabase.co",
      productionApiUrl: undefined,
      productionDatabaseUrl: undefined,
      productionSupabaseUrl: undefined,
      productionTelegramBotToken: undefined,
      productionJwtSecret: undefined,
      productionStorageServiceKey: undefined,
    })).toThrow("Production baseline");
  });

  test("allows a fully local E2E configuration without a production baseline", () => {
    expect(() => assertSafeE2EEnvironment({
      ...safeConfig,
      databaseUrl: "postgresql://127.0.0.1:55432/e2e",
      supabaseUrl: "http://127.0.0.1:54321",
      productionApiUrl: undefined,
      productionDatabaseUrl: undefined,
      productionSupabaseUrl: undefined,
      productionTelegramBotToken: undefined,
      productionJwtSecret: undefined,
      productionStorageServiceKey: undefined,
    })).not.toThrow();
  });
});
