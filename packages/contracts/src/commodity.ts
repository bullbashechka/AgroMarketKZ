import { z } from "zod";

/** Группа зернового/масличного/зернобобового товара. */
export const commodityGroupSchema = z.enum(["cereals", "oilseeds", "pulses"]);
export type CommodityGroup = z.infer<typeof commodityGroupSchema>;

export const commodityGroupLabels: Record<CommodityGroup, string> = {
  cereals: "Зерновые",
  oilseeds: "Масличные",
  pulses: "Зернобобовые"
};

export const commodityGroupListSchema = z.array(commodityGroupSchema)
  .max(3)
  .refine((groups) => new Set(groups).size === groups.length, "Группы не должны повторяться");

export const volumeTonnesSchema = z.number({ error: "Укажите объём числом" })
  .finite({ error: "Укажите корректный объём" })
  .min(0.001, { error: "Объём должен быть больше нуля" })
  .max(99_999_999_999.999, { error: "Слишком большой объём" })
  .refine((value) => Number.isInteger(value * 1000), { error: "Объём можно указать максимум с 3 знаками после запятой" });

export type VolumeTonnes = z.infer<typeof volumeTonnesSchema>;

export const productSortSchema = z.enum(["default", "price_asc", "volume_asc"]);
export type ProductSort = z.infer<typeof productSortSchema>;

export const productSortLabels: Record<ProductSort, string> = {
  default: "По умолчанию",
  price_asc: "По цене: от меньшего к большему",
  volume_asc: "По объёму: от меньшего к большему"
};
