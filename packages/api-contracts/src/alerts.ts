import { z } from "zod";

/** Wire shape of AlertQueue's PendingEBirdAlert (dates as ISO strings). */
export const pendingAlertSchema = z.object({
  audioCount: z.number().int(),
  channelId: z.string(),
  comName: z.string(),
  county: z.string(),
  createdAt: z.iso.datetime(),
  howMany: z.number().int(),
  isPrivate: z.boolean(),
  locationName: z.string(),
  locId: z.string(),
  obsDt: z.iso.datetime(),
  photoCount: z.number().int(),
  recentlyConfirmed: z.boolean(),
  sciName: z.string(),
  speciesCode: z.string(),
  state: z.string(),
  subId: z.string(),
  videoCount: z.number().int(),
});
export type PendingAlert = z.infer<typeof pendingAlertSchema>;

export const pendingAlertsResponseSchema = z.object({
  alerts: z.array(pendingAlertSchema),
});
export type PendingAlertsResponse = z.infer<typeof pendingAlertsResponseSchema>;
