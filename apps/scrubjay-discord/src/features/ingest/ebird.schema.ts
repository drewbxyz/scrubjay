import { z } from "zod";

export const RawEBirdObservationSchema = z.object({
  checklistId: z.string(),
  comName: z.string(),
  countryCode: z.string(),
  countryName: z.string(),
  evidence: z.enum(["P", "A", "V"]).optional().nullable(),
  firstName: z.string().optional().default(""),
  hasComments: z.boolean(),
  hasRichMedia: z.boolean(),
  howMany: z.number().int().optional(),
  lastName: z.string().optional().default(""),
  lat: z.number(),
  lng: z.number(),
  locationPrivate: z.boolean(),
  locId: z.string(),
  locName: z.string(),
  obsDt: z
    .string()
    .refine(
      (s) => !Number.isNaN(Date.parse(s)),
      "unparseable observation date",
    ),
  obsId: z.string(),
  obsReviewed: z.boolean(),
  obsValid: z.boolean(),
  presenceNoted: z.boolean(),
  sciName: z.string(),
  speciesCode: z.string(),
  subId: z.string(),
  subnational1Code: z.string(),
  subnational1Name: z.string(),
  subnational2Code: z.string(),
  subnational2Name: z.string(),
  userDisplayName: z.string().optional().default(""),
});

export type EBirdObservation = z.infer<typeof RawEBirdObservationSchema>;
