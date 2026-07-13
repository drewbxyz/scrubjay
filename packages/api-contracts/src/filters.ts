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
  /**
   * Matching against observations is exact and case-sensitive against the
   * eBird common name (mirrors the 👎-reaction semantics), so a non-canonical
   * value silently never matches (e.g. "verdin" never matches "Verdin").
   * Clients should send the canonical eBird common name. Trimmed on add for
   * hygiene; the delete path preserves whitespace so stored names remain
   * deletable.
   */
  commonName: z.string().trim().min(1),
});
export type AddFilterBody = z.infer<typeof addFilterBodySchema>;

/**
 * Add is an idempotent "ensure": `added` is true only when a row was actually
 * inserted, false when the filter already existed (the insert was a no-op).
 */
export const addFilterResponseSchema = z.object({
  added: z.boolean(),
});
export type AddFilterResponse = z.infer<typeof addFilterResponseSchema>;

/**
 * Delete targets an exact stored name, so it must NOT trim: the 👎 path can
 * store a name with edge whitespace, and trimming here would make it
 * undeletable via the API. Min-length still guards against empty input.
 */
export const deleteFilterQuerySchema = z.object({
  commonName: z.string().min(1),
});
export type DeleteFilterQuery = z.infer<typeof deleteFilterQuerySchema>;
