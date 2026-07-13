import { z } from "zod";

export const channelFilterSchema = z.object({
  channelId: z.string().min(1),
  commonName: z.string().min(1),
});
export type ChannelFilter = z.infer<typeof channelFilterSchema>;

export const listFiltersResponseSchema = z.object({
  filters: z.array(channelFilterSchema),
});
export type ListFiltersResponse = z.infer<typeof listFiltersResponseSchema>;

/** Free-text common name, matching the 👎 reaction semantics. */
export const addFilterBodySchema = z.object({
  commonName: z.string().trim().min(1),
});
export type AddFilterBody = z.infer<typeof addFilterBodySchema>;
