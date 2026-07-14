import type {
  ListDeliveriesQuery,
  ListDeliveriesResponse,
  ListObservationsQuery,
  ListObservationsResponse,
  PendingAlertsResponse,
  RegionsResponse,
} from "@scrubjay/api-contracts";
import {
  listDeliveriesQuerySchema,
  listDeliveriesResponseSchema,
  listObservationsQuerySchema,
  listObservationsResponseSchema,
  pendingAlertsResponseSchema,
  regionsResponseSchema,
} from "@scrubjay/api-contracts";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { botApi, toQuery } from "@/server/bot-api";
import { env } from "@/server/env";
import { requireOperator } from "@/server/operators";

export function fetchRegionsImpl(): Promise<RegionsResponse> {
  return botApi(regionsResponseSchema, {
    endpoint: "regions.list",
    path: "/api/v1/regions",
  });
}

export function listObservationsImpl(
  query: ListObservationsQuery,
): Promise<ListObservationsResponse> {
  return botApi(listObservationsResponseSchema, {
    endpoint: "observations.list",
    path: `/api/v1/observations${toQuery(query)}`,
  });
}

export function listDeliveriesImpl(
  query: ListDeliveriesQuery,
): Promise<ListDeliveriesResponse> {
  return botApi(listDeliveriesResponseSchema, {
    endpoint: "deliveries.list",
    path: `/api/v1/deliveries${toQuery(query)}`,
  });
}

export function fetchPendingAlertsImpl(): Promise<PendingAlertsResponse> {
  return botApi(pendingAlertsResponseSchema, {
    endpoint: "alerts.pending",
    path: "/api/v1/alerts/pending",
  });
}

const healthBodySchema = z.looseObject({ status: z.string() });

export interface BotHealth {
  ok: boolean;
  status: string;
}

/** /health sits outside /api/v1 (public, no bearer) — plain fetch, no envelope. */
export async function fetchBotHealthImpl(): Promise<BotHealth> {
  try {
    const response = await fetch(new URL("/health", env().BOT_API_URL));
    const parsed = healthBodySchema.safeParse(
      await response.json().catch(() => undefined),
    );
    return {
      ok: response.ok,
      status: parsed.success ? parsed.data.status : `http ${response.status}`,
    };
  } catch {
    return { ok: false, status: "unreachable" };
  }
}

export const fetchRegions = createServerFn({ method: "GET" }).handler(
  async () => {
    await requireOperator();
    return fetchRegionsImpl();
  },
);

export const listObservations = createServerFn({ method: "GET" })
  .validator(listObservationsQuerySchema)
  .handler(async ({ data }) => {
    await requireOperator();
    return listObservationsImpl(data);
  });

export const listDeliveries = createServerFn({ method: "GET" })
  .validator(listDeliveriesQuerySchema)
  .handler(async ({ data }) => {
    await requireOperator();
    return listDeliveriesImpl(data);
  });

export const fetchPendingAlerts = createServerFn({ method: "GET" }).handler(
  async () => {
    await requireOperator();
    return fetchPendingAlertsImpl();
  },
);

export const fetchBotHealth = createServerFn({ method: "GET" }).handler(
  async () => {
    await requireOperator();
    return fetchBotHealthImpl();
  },
);
