import { afterAll, expect, test } from "bun:test";
import { describeIntegration, openIntegrationSql } from "./integrationTestDatabase";

describeIntegration("runtime capability boundary", () => {
  const sql = openIntegrationSql();

  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  test("allows required access but denies unrelated object privileges and schema creation", async () => {
    await sql.unsafe("create table app_private.runtime_capability_audit_unrelated (id uuid primary key)");
    await sql.unsafe("create schema runtime_capability_audit_unrelated");
    await sql.unsafe("create table runtime_capability_audit_unrelated.runtime_capability_audit_unrelated (id uuid primary key)");
    try {
      await expect(sql.begin(async (transaction) => {
        await transaction.unsafe("set local role agromarket_runtime");
        return transaction`select 1 from app_private.notification_outbox limit 1`;
      })).resolves.toEqual([]);
      await expect(sql.begin(async (transaction) => {
        await transaction.unsafe("set local role agromarket_runtime");
        return transaction`delete from app_private.admin_audit_events`;
      })).rejects.toThrow(/permission denied/i);
      await expect(sql.begin(async (transaction) => {
        await transaction.unsafe("set local role agromarket_runtime");
        return transaction`select 1 from app_private.runtime_capability_audit_unrelated`;
      })).rejects.toThrow(/permission denied/i);
      await expect(sql.begin(async (transaction) => {
        await transaction.unsafe("set local role agromarket_runtime");
        return transaction`select 1 from runtime_capability_audit_unrelated.runtime_capability_audit_unrelated`;
      })).rejects.toThrow(/permission denied/i);
      await expect(sql.begin(async (transaction) => {
        await transaction.unsafe("set local role agromarket_runtime");
        return transaction.unsafe("create table app_private.runtime_capability_audit_forbidden (id integer)");
      })).rejects.toThrow(/permission denied/i);
    } finally {
      await sql.unsafe("drop table app_private.runtime_capability_audit_unrelated");
      await sql.unsafe("drop schema runtime_capability_audit_unrelated cascade");
    }
  });
});
