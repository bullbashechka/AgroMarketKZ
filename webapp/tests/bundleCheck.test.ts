import { describe, expect, test } from "bun:test";
import {
  collectInitialEntries,
  MAX_INITIAL_JAVASCRIPT_BYTES,
  REQUIRED_LAZY_SOURCES,
  validateBundleContract,
} from "../scripts/check-bundle";

describe("collectInitialEntries", () => {
  test("includes only static imports of the browser entry", () => {
    const entries = collectInitialEntries({
      "index.html": {
        file: "assets/index.js",
        isEntry: true,
        imports: ["_shared.js"],
      },
      "_shared.js": {
        file: "assets/shared.js",
        imports: ["_runtime.js"],
      },
      "_runtime.js": {
        file: "assets/runtime.js",
      },
      "src/screens/admin/AdminCardsScreen.tsx": {
        file: "assets/admin.js",
      },
    });

    expect([...entries]).toEqual(["index.html", "_shared.js", "_runtime.js"]);
  });

  test("fails when an import points to a missing manifest entry", () => {
    expect(() =>
      collectInitialEntries({
        "index.html": {
          file: "assets/index.js",
          isEntry: true,
          imports: ["_missing.js"],
        },
      })
    ).toThrow("Vite manifest references missing chunk: _missing.js");
  });

  test("rejects an initial bundle over the fixed budget", () => {
    expect(() =>
      validateBundleContract({
        chunks: [{ file: "assets/index.js", gzipBytes: 1, rawBytes: MAX_INITIAL_JAVASCRIPT_BYTES + 1, source: "index.html" }],
        dynamicImports: REQUIRED_LAZY_SOURCES,
      })
    ).toThrow("Initial JavaScript exceeds budget");
  });

  test("rejects admin/editor source in the initial dependency graph", () => {
    expect(() =>
      validateBundleContract({
        chunks: [{ file: "assets/admin.js", gzipBytes: 1, rawBytes: 1, source: "src/screens/admin/AdminCardsScreen.tsx" }],
        dynamicImports: REQUIRED_LAZY_SOURCES,
      })
    ).toThrow("Admin/editor sources are present in the initial graph");
  });

  test("requires every secondary route to remain a dynamic import", () => {
    expect(() =>
      validateBundleContract({
        chunks: [{ file: "assets/index.js", gzipBytes: 1, rawBytes: 1, source: "index.html" }],
        dynamicImports: REQUIRED_LAZY_SOURCES.slice(1),
      })
    ).toThrow("Expected lazy routes are no longer dynamic imports");
  });
});
