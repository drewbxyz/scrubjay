import { z } from "zod";

export const subscriptionSchema = z.object({
  active: z.boolean(),
  channelId: z.string().min(1),
  countyCode: z.string().min(1),
  lastUpdated: z.iso.datetime(),
  stateCode: z.string().min(1),
});
export type Subscription = z.infer<typeof subscriptionSchema>;

export const listSubscriptionsQuerySchema = z.object({
  channelId: z.string().min(1).optional(),
  stateCode: z.string().min(1).optional(),
});
export type ListSubscriptionsQuery = z.infer<
  typeof listSubscriptionsQuerySchema
>;

export const listSubscriptionsResponseSchema = z.object({
  subscriptions: z.array(subscriptionSchema),
});
export type ListSubscriptionsResponse = z.infer<
  typeof listSubscriptionsResponseSchema
>;

/** Mirrors the /subscribe slash command: region parsing happens server-side. */
export const createSubscriptionBodySchema = z.object({
  channelId: z.string().min(1),
  regionCode: z.string().min(1),
});
export type CreateSubscriptionBody = z.infer<
  typeof createSubscriptionBodySchema
>;

export const createSubscriptionResponseSchema = z.object({
  created: z.boolean(),
});
export type CreateSubscriptionResponse = z.infer<
  typeof createSubscriptionResponseSchema
>;

/** Subscriptions have no surrogate id; the composite key addresses them. */
export const subscriptionKeySchema = z.object({
  channelId: z.string().min(1),
  countyCode: z.string().min(1),
  stateCode: z.string().min(1),
});
export type SubscriptionKey = z.infer<typeof subscriptionKeySchema>;

export const updateSubscriptionBodySchema = subscriptionKeySchema.extend({
  active: z.boolean(),
});
export type UpdateSubscriptionBody = z.infer<
  typeof updateSubscriptionBodySchema
>;
