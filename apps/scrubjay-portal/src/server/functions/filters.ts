import type {
  AddFilterResponse,
  ListFiltersResponse,
} from "@scrubjay/api-contracts";
import {
  addFilterResponseSchema,
  channelIdSchema,
  listFiltersResponseSchema,
} from "@scrubjay/api-contracts";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { botApi, toQuery } from "@/server/bot-api";
import { requireOperator } from "@/server/operators";
import type { DeletedResponse } from "./subscriptions";
import { deletedResponseSchema } from "./subscriptions";

const channelInputSchema = z.object({ channelId: channelIdSchema });
const filterInputSchema = channelInputSchema.extend({
  commonName: z.string().min(1),
});

export function listFiltersImpl(
  channelId: string,
): Promise<ListFiltersResponse> {
  return botApi(listFiltersResponseSchema, {
    endpoint: "filters.list",
    path: `/api/v1/channels/${channelId}/filters`,
  });
}

export function addFilterImpl(
  input: z.infer<typeof filterInputSchema>,
): Promise<AddFilterResponse> {
  return botApi(addFilterResponseSchema, {
    body: { commonName: input.commonName },
    endpoint: "filters.add",
    method: "POST",
    path: `/api/v1/channels/${input.channelId}/filters`,
  });
}

export function removeFilterImpl(
  input: z.infer<typeof filterInputSchema>,
): Promise<DeletedResponse> {
  return botApi(deletedResponseSchema, {
    endpoint: "filters.remove",
    method: "DELETE",
    path: `/api/v1/channels/${input.channelId}/filters${toQuery({
      commonName: input.commonName,
    })}`,
  });
}

export const listFilters = createServerFn({ method: "GET" })
  .validator(channelInputSchema)
  .handler(async ({ data }) => {
    await requireOperator();
    return listFiltersImpl(data.channelId);
  });

export const addFilter = createServerFn({ method: "POST" })
  .validator(filterInputSchema)
  .handler(async ({ data }) => {
    await requireOperator();
    return addFilterImpl(data);
  });

export const removeFilter = createServerFn({ method: "POST" })
  .validator(filterInputSchema)
  .handler(async ({ data }) => {
    await requireOperator();
    return removeFilterImpl(data);
  });
