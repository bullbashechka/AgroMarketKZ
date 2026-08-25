import { z } from "zod";

export const territoryCodes = [
  "abay_region",
  "akmola_region",
  "aktobe_region",
  "almaty_region",
  "atyrau_region",
  "east_kazakhstan_region",
  "zhambyl_region",
  "zhetysu_region",
  "west_kazakhstan_region",
  "karaganda_region",
  "kostanay_region",
  "kyzylorda_region",
  "mangystau_region",
  "pavlodar_region",
  "north_kazakhstan_region",
  "turkistan_region",
  "ulytau_region",
  "almaty_city",
  "astana_city",
  "shymkent_city"
] as const;

/** Точные 17 областей Казахстана; города республиканского значения в фильтре товаров не участвуют. */
export const productTerritoryCodes = [
  "abay_region",
  "akmola_region",
  "aktobe_region",
  "almaty_region",
  "atyrau_region",
  "east_kazakhstan_region",
  "zhambyl_region",
  "zhetysu_region",
  "west_kazakhstan_region",
  "karaganda_region",
  "kostanay_region",
  "kyzylorda_region",
  "mangystau_region",
  "pavlodar_region",
  "north_kazakhstan_region",
  "turkistan_region",
  "ulytau_region"
] as const;

export const productTerritoryCodeSchema = z.enum(productTerritoryCodes);
export type ProductTerritoryCode = z.infer<typeof productTerritoryCodeSchema>;

export const territoryCodeSchema = z.enum(territoryCodes);
export type TerritoryCode = z.infer<typeof territoryCodeSchema>;

export const territoryKindSchema = z.enum(["region", "republican_city"]);
export type TerritoryKind = z.infer<typeof territoryKindSchema>;

export const territorySchema = z.object({
  code: territoryCodeSchema,
  name: z.string(),
  kind: territoryKindSchema,
  sortOrder: z.number().int().nonnegative()
});
export type Territory = z.infer<typeof territorySchema>;

export const territoryListResponse = z.array(territorySchema);

export const catalogRegionFilterSchema = z.union([
  z.literal("all_regions"),
  z.literal("republican_cities"),
  territoryCodeSchema
]);
export type CatalogRegionFilter = z.infer<typeof catalogRegionFilterSchema>;

export const productOwnershipFormSchema = z.enum([
  "peasant_farm",
  "llp_vat_agricultural_producer",
  "llp_trader"
]);
export type ProductOwnershipForm = z.infer<typeof productOwnershipFormSchema>;

export const productOwnershipFormLabels: Record<ProductOwnershipForm, string> = {
  peasant_farm: "КХ",
  llp_vat_agricultural_producer: "ТОО НДС СХТП",
  llp_trader: "ТОО Трейдер"
};

export const productOwnershipFormListSchema = z.array(productOwnershipFormSchema)
  .max(3)
  .refine((forms) => new Set(forms).size === forms.length, "Формы собственности не должны повторяться");

export const productLocationSchema = z.enum(["elevator", "seller_site"]);
export type ProductLocation = z.infer<typeof productLocationSchema>;

export const productLocationLabels: Record<ProductLocation, string> = {
  elevator: "На элеваторе",
  seller_site: "С места"
};
