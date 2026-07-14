import { z } from "zod";
import { subscriptionSchema } from "./subscriptions.js";

/** Read-only: ingest regions stay derived from subscriptions (spec). */
export const regionSchema = z.object({
  stateCode: z.string().min(1),
  subscriptions: z.array(subscriptionSchema),
});
export type Region = z.infer<typeof regionSchema>;

export const regionsResponseSchema = z.object({
  regions: z.array(regionSchema),
});
export type RegionsResponse = z.infer<typeof regionsResponseSchema>;
