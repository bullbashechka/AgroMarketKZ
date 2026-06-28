import { z } from "zod";

export const healthResponseSchema = z.object({
  status: z.literal("ok"),
  app: z.literal("backend")
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
