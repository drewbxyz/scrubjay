import type {
  CreateSubscriptionResponse,
  ListSubscriptionsQuery,
  ListSubscriptionsResponse,
  UpdateSubscriptionResponse,
} from "@scrubjay/api-contracts";
import {
  channelIdSchema,
  createSubscriptionResponseSchema,
  listSubscriptionsQuerySchema,
  listSubscriptionsResponseSchema,
  updateSubscriptionResponseSchema,
} from "@scrubjay/api-contracts";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { botApi, toQuery } from "@/server/bot-api";
import { requireOperator } from "@/server/operators";

export const deletedResponseSchema = z.object({ deleted: z.boolean() });
export type DeletedResponse = z.infer<typeof deletedResponseSchema>;

const createInputSchema = z.object({
  channelId: channelIdSchema,
  regionCode: z.string().min(1),
});
const regionKeyInputSchema = z.object({
  channelId: channelIdSchema,
  countyCode: z.string().min(1),
  stateCode: z.string().min(1),
});
const updateInputSchema = regionKeyInputSchema.extend({ active: z.boolean() });

export function listSubscriptionsImpl(
  query: ListSubscriptionsQuery,
): Promise<ListSubscriptionsResponse> {
  return botApi(listSubscriptionsResponseSchema, {
    endpoint: "subscriptions.list",
    path: `/api/v1/subscriptions${toQuery(query)}`,
  });
}

export function createSubscriptionImpl(
  input: z.infer<typeof createInputSchema>,
): Promise<CreateSubscriptionResponse> {
  return botApi(createSubscriptionResponseSchema, {
    body: { regionCode: input.regionCode },
    endpoint: "subscriptions.create",
    method: "POST",
    path: `/api/v1/channels/${input.channelId}/subscriptions`,
  });
}

export function updateSubscriptionImpl(
  input: z.infer<typeof updateInputSchema>,
): Promise<UpdateSubscriptionResponse> {
  return botApi(updateSubscriptionResponseSchema, {
    body: {
      active: input.active,
      countyCode: input.countyCode,
      stateCode: input.stateCode,
    },
    endpoint: "subscriptions.update",
    method: "PATCH",
    path: `/api/v1/channels/${input.channelId}/subscriptions`,
  });
}

export function deleteSubscriptionImpl(
  input: z.infer<typeof regionKeyInputSchema>,
): Promise<DeletedResponse> {
  return botApi(deletedResponseSchema, {
    endpoint: "subscriptions.delete",
    method: "DELETE",
    path: `/api/v1/channels/${input.channelId}/subscriptions${toQuery({
      countyCode: input.countyCode,
      stateCode: input.stateCode,
    })}`,
  });
}

export const listSubscriptions = createServerFn({ method: "GET" })
  .validator(listSubscriptionsQuerySchema)
  .handler(async ({ data }) => {
    await requireOperator();
    return listSubscriptionsImpl(data);
  });

export const createSubscription = createServerFn({ method: "POST" })
  .validator(createInputSchema)
  .handler(async ({ data }) => {
    await requireOperator();
    return createSubscriptionImpl(data);
  });

export const updateSubscription = createServerFn({ method: "POST" })
  .validator(updateInputSchema)
  .handler(async ({ data }) => {
    await requireOperator();
    return updateSubscriptionImpl(data);
  });

export const deleteSubscription = createServerFn({ method: "POST" })
  .validator(regionKeyInputSchema)
  .handler(async ({ data }) => {
    await requireOperator();
    return deleteSubscriptionImpl(data);
  });
