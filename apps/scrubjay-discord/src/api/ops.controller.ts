import { Controller, Get, Query, UseFilters, UseGuards } from "@nestjs/common";
import {
  type ListDeliveriesQuery,
  type ListObservationsQuery,
  listDeliveriesQuerySchema,
  listObservationsQuerySchema,
} from "@scrubjay/api-contracts";
import { AlertQueue } from "@/features/dispatch/alert-queue.service";
import { SubscriptionsRepository } from "@/features/subscriptions/subscriptions.repository";
import { API_PREFIX } from "./api.constants";
import { ApiExceptionFilter } from "./api-exception.filter";
import { ApiTokenGuard } from "./api-token.guard";
import { OpsRepository } from "./ops.repository";
import { ZodValidationPipe } from "./zod-validation.pipe";

@Controller(API_PREFIX)
@UseFilters(ApiExceptionFilter)
@UseGuards(ApiTokenGuard)
export class OpsController {
  constructor(
    private readonly alertQueue: AlertQueue,
    private readonly ops: OpsRepository,
    private readonly subscriptions: SubscriptionsRepository,
  ) {}

  /** Ingest regions stay derived from subscriptions; this is the read view. */
  @Get("regions")
  async regions() {
    const subs = await this.subscriptions.listSubscriptions();
    const byState = new Map<string, typeof subs>();
    for (const sub of subs) {
      const bucket = byState.get(sub.stateCode) ?? [];
      bucket.push(sub);
      byState.set(sub.stateCode, bucket);
    }
    return {
      regions: [...byState.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([stateCode, subscriptions]) => ({ stateCode, subscriptions })),
    };
  }

  @Get("observations")
  async observations(
    @Query(new ZodValidationPipe(listObservationsQuerySchema))
    query: ListObservationsQuery,
  ) {
    return this.ops.listObservations(query);
  }

  @Get("deliveries")
  async deliveries(
    @Query(new ZodValidationPipe(listDeliveriesQuerySchema))
    query: ListDeliveriesQuery,
  ) {
    return this.ops.listDeliveries(query);
  }

  /** Diagnostic view; semantics live in AlertQueue (see CONTEXT.md). */
  @Get("alerts/pending")
  async pendingAlerts() {
    return { alerts: await this.alertQueue.pendingEBirdAlerts() };
  }
}
