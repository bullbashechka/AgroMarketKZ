# Task 1 working-tree review package

No commits were created because repository instructions prohibit commits without explicit user authorization. This package records only Task 1 files.

## `backend/src/db.ts`

```diff
@@
 let client: Sql | undefined;
 
+export const POSTGRES_POOL_OPTIONS = Object.freeze({
+  max: 3,
+  idle_timeout: 20,
+  connect_timeout: 10,
+  prepare: false,
+}) satisfies postgres.Options<{}>;
+
@@
-    client = postgres(env.DATABASE_URL, { prepare: false });
+    client = postgres(env.DATABASE_URL, POSTGRES_POOL_OPTIONS);
```

## `backend/tests/db.test.ts` (new)

```ts
import { describe, expect, test } from "bun:test";
import { POSTGRES_POOL_OPTIONS } from "../src/db";

describe("POSTGRES_POOL_OPTIONS", () => {
  test("задаёт безопасные параметры пула без переопределения max_lifetime", () => {
    expect(POSTGRES_POOL_OPTIONS).toEqual({
      max: 3,
      idle_timeout: 20,
      connect_timeout: 10,
      prepare: false,
    });
    expect(
      Object.prototype.hasOwnProperty.call(
        POSTGRES_POOL_OPTIONS,
        "max_lifetime",
      ),
    ).toBe(false);
  });
});
```
