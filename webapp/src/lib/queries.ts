import type { CatalogType, Category } from "@agromarket/contracts";
import { queryOptions } from "@tanstack/react-query";
import { apiGet } from "./api";

export const categoriesQueryOptions = (type: CatalogType) =>
  queryOptions({
    queryKey: ["categories", type] as const,
    queryFn: () => apiGet<Category[]>(`/catalog/categories?type=${type}`)
  });
