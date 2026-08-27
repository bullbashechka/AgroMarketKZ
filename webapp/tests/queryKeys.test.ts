import { describe, expect, test } from "bun:test";
import type { QueryClient } from "@tanstack/react-query";
import {
  adminCatalogQueryKeys,
  catalogQueryKeys,
  invalidateCatalogAfterAdminCardMutation,
} from "../src/lib/queries";

describe("catalog query-key ownership", () => {
  test("invalidates every list and the affected public detail after an admin card mutation", () => {
    const calls: unknown[] = [];
    const queryClient = {
      invalidateQueries: (filters: unknown) => {
        calls.push(filters);
        return Promise.resolve();
      },
    } as unknown as QueryClient;

    invalidateCatalogAfterAdminCardMutation(queryClient, "card-1");

    expect(calls).toEqual([
      { queryKey: adminCatalogQueryKeys.cards },
      { queryKey: adminCatalogQueryKeys.categories },
      { queryKey: catalogQueryKeys.cards },
      { queryKey: catalogQueryKeys.categories },
      { queryKey: catalogQueryKeys.listingCategories },
      { queryKey: catalogQueryKeys.favorites },
      { queryKey: catalogQueryKeys.card("card-1") },
    ]);
  });

  test("deletion still invalidates every list when the detail query was removed first", () => {
    const calls: unknown[] = [];
    const queryClient = {
      invalidateQueries: (filters: unknown) => {
        calls.push(filters);
        return Promise.resolve();
      },
    } as unknown as QueryClient;

    invalidateCatalogAfterAdminCardMutation(queryClient);

    expect(calls).toEqual([
      { queryKey: adminCatalogQueryKeys.cards },
      { queryKey: adminCatalogQueryKeys.categories },
      { queryKey: catalogQueryKeys.cards },
      { queryKey: catalogQueryKeys.categories },
      { queryKey: catalogQueryKeys.listingCategories },
      { queryKey: catalogQueryKeys.favorites },
    ]);
  });
});
