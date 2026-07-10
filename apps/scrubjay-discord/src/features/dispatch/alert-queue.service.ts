import { Injectable } from "@nestjs/common";
import type { DeliveryStatus } from "@/core/drizzle/drizzle.schema";
import type { DbOrTx } from "@/core/drizzle/drizzle.service";
import {
  AlertQueueRepository,
  type PendingEBirdAlert,
  type SubscriptionScope,
} from "./alert-queue.repository";

const RECORD_BATCH_SIZE = 100;

export type { PendingEBirdAlert, SubscriptionScope };

export type AlertRef = {
  speciesCode: string;
  subId: string;
  channelId: string;
};

/**
 * The dispatch module's seam: decides which alerts are pending and records
 * which were sent. An alert is pending for a channel when the observation
 * matches an active subscription, the species is not filtered on that
 * channel, and no delivery exists yet.
 */
@Injectable()
export class AlertQueue {
  constructor(private readonly repository: AlertQueueRepository) {}

  async pendingEBirdAlerts(since?: Date): Promise<PendingEBirdAlert[]> {
    return this.repository.pendingEBirdAlerts(since);
  }

  /**
   * Record a terminal outcome for alerts. Idempotent (unique on
   * kind+alertId+channelId); owns the alertId format — callers never build it.
   * Every status is terminal: any delivery row excludes the alert from pending.
   */
  async record(
    alerts: AlertRef[],
    status: DeliveryStatus,
    detail?: string,
  ): Promise<void> {
    for (let i = 0; i < alerts.length; i += RECORD_BATCH_SIZE) {
      const batch = alerts.slice(i, i + RECORD_BATCH_SIZE).map((alert) => ({
        alertId: `${alert.speciesCode}:${alert.subId}`,
        channelId: alert.channelId,
        detail: detail ?? null,
        kind: "ebird" as const,
        status,
      }));
      await this.repository.insertDeliveries(batch);
    }
  }

  /**
   * Mark every currently-pending alert for one Subscription as delivered
   * without sending it — the subscribe-time backfill. Pass `db` (a transaction
   * handle) to compose this atomically with the subscription insert, otherwise
   * a dispatch tick landing in between would see the new Subscription but not
   * yet its backfill, and actually send the historical alerts.
   */
  async backfillEBird(scope: SubscriptionScope, db?: DbOrTx): Promise<void> {
    await this.repository.backfillDeliveries(scope, db);
  }

  /** Deactivate a dead channel's subscriptions (spec §2, Unknown Channel). */
  async deactivateChannel(channelId: string): Promise<number> {
    return this.repository.deactivateChannelSubscriptions(channelId);
  }
}
