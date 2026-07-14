import { z } from "zod";

/** eBird subnational1 code: country-state, e.g. US-CA. */
export const stateCodeSchema = z
  .string()
  .regex(/^[A-Z]{2}-[A-Z0-9]{1,10}$/, "expected a code like US-CA");

export const countySchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
});
export type County = z.infer<typeof countySchema>;

export const countiesResponseSchema = z.object({
  counties: z.array(countySchema),
});
export type CountiesResponse = z.infer<typeof countiesResponseSchema>;
