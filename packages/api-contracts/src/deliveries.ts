import { z } from "zod";
import { channelIdSchema, paginationQuerySchema } from "./common.js";

export const deliveryStatusSchema = z.enum([
  "sent",
  "failed",
  "expired",
  "suppressed",
]);
export type DeliveryStatus = z.infer<typeof deliveryStatusSchema>;

export const deliverySchema = z.object({
  alertId: z.string(),
  channelId: z.string(),
  detail: z.string().nullable(),
  id: z.number().int(),
  kind: z.string(),
  sentAt: z.iso.datetime().nullable(),
  status: deliveryStatusSchema,
});
export type Delivery = z.infer<typeof deliverySchema>;

export const listDeliveriesQuerySchema = paginationQuerySchema.extend({
  alertId: z.string().min(1).optional(),
  channelId: channelIdSchema.optional(),
  status: deliveryStatusSchema.optional(),
});
export type ListDeliveriesQuery = z.infer<typeof listDeliveriesQuerySchema>;

export const listDeliveriesResponseSchema = z.object({
  deliveries: z.array(deliverySchema),
  hasMore: z.boolean(),
});
export type ListDeliveriesResponse = z.infer<
  typeof listDeliveriesResponseSchema
>;
