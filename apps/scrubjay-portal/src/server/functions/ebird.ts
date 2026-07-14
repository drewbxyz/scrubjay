import type { CountiesResponse } from "@scrubjay/api-contracts";
import {
  countiesResponseSchema,
  stateCodeSchema,
} from "@scrubjay/api-contracts";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { botApi } from "@/server/bot-api";
import { requireOperator } from "@/server/operators";

const countiesInputSchema = z.object({ stateCode: stateCodeSchema });

export function fetchCountiesImpl(
  stateCode: string,
): Promise<CountiesResponse> {
  return botApi(countiesResponseSchema, {
    endpoint: "ebird.counties",
    path: `/api/v1/ebird/regions/${stateCode}/counties`,
  });
}

export const fetchCounties = createServerFn({ method: "GET" })
  .validator(countiesInputSchema)
  .handler(async ({ data }) => {
    await requireOperator();
    return fetchCountiesImpl(data.stateCode);
  });
