import { z } from "zod";

/** Every non-2xx API response uses this envelope. */
export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    details: z.unknown().optional(),
    message: z.string(),
  }),
});
export type ApiError = z.infer<typeof apiErrorSchema>;

export const paginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

/** Discord snowflake id. */
export const channelIdSchema = z.string().regex(/^\d{17,20}$/);
export type ChannelId = z.infer<typeof channelIdSchema>;
