import { z } from "zod";
import { paginationQuerySchema } from "./common.js";

export const observationSchema = z.object({
  audioCount: z.number().int(),
  comName: z.string(),
  county: z.string(),
  countyCode: z.string(),
  createdAt: z.iso.datetime(),
  howMany: z.number().int(),
  locationName: z.string(),
  locId: z.string(),
  obsDt: z.iso.datetime(),
  obsReviewed: z.boolean(),
  obsValid: z.boolean(),
  photoCount: z.number().int(),
  sciName: z.string(),
  speciesCode: z.string(),
  state: z.string(),
  stateCode: z.string(),
  subId: z.string(),
  videoCount: z.number().int(),
});
export type Observation = z.infer<typeof observationSchema>;

export const listObservationsQuerySchema = paginationQuerySchema.extend({
  countyCode: z.string().min(1).optional(),
  since: z.iso.datetime().optional(),
  speciesCode: z.string().min(1).optional(),
  stateCode: z.string().min(1).optional(),
});
export type ListObservationsQuery = z.infer<typeof listObservationsQuerySchema>;

export const listObservationsResponseSchema = z.object({
  hasMore: z.boolean(),
  observations: z.array(observationSchema),
});
export type ListObservationsResponse = z.infer<
  typeof listObservationsResponseSchema
>;
