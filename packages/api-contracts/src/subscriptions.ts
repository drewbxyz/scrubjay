import { z } from "zod";
import { channelIdSchema } from "./common.js";

export const subscriptionSchema = z.object({
  active: z.boolean(),
  channelId: z.string().min(1),
  countyCode: z.string().min(1),
  lastUpdated: z.iso.datetime(),
  stateCode: z.string().min(1),
});
export type Subscription = z.infer<typeof subscriptionSchema>;

export const listSubscriptionsQuerySchema = z.object({
  channelId: channelIdSchema.optional(),
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

/**
 * Region round-trip. The channel that owns a subscription lives in the path
 * (`channels/:channelId/subscriptions`), never the payload. Create takes an
 * eBird `regionCode` (e.g. "US-CA" statewide, or "US-CA-085" for a county),
 * which the server parses. The list endpoint returns the parsed key split into
 * `stateCode` and `countyCode`, with `countyCode: "*"` marking a statewide
 * subscription. PATCH and DELETE address an existing subscription by that split
 * region key (see `subscriptionRegionKeySchema`).
 */
export const createSubscriptionBodySchema = z.object({
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

/**
 * The split region key that addresses a subscription within a channel. The
 * channel comes from the route path; only the region halves travel in the
 * query/body. `countyCode: "*"` denotes a statewide subscription.
 */
export const subscriptionRegionKeySchema = z.object({
  countyCode: z.string().min(1),
  stateCode: z.string().min(1),
});
export type SubscriptionRegionKey = z.infer<typeof subscriptionRegionKeySchema>;

export const updateSubscriptionBodySchema = subscriptionRegionKeySchema.extend({
  active: z.boolean(),
});
export type UpdateSubscriptionBody = z.infer<
  typeof updateSubscriptionBodySchema
>;

/** PATCH returns the mutated row in the same wire shape as a list element. */
export const updateSubscriptionResponseSchema = z.object({
  subscription: subscriptionSchema,
});
export type UpdateSubscriptionResponse = z.infer<
  typeof updateSubscriptionResponseSchema
>;
