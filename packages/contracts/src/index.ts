import { z } from "zod";

export const healthResponseSchema = z.object({
  status: z.literal("ok"),
  app: z.literal("backend")
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;

export * from "./constants";
export * from "./enums";
export * from "./phone";
export * from "./primitives";
export * from "./pagination";
export * from "./category";
export * from "./card";
export * from "./catalog";
export * from "./favorite";
export * from "./request";
export * from "./feedback";
export * from "./profile";
export * from "./auth";
export * from "./settings";
