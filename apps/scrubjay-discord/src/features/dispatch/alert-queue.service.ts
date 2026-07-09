import { Injectable } from "@nestjs/common";
import type { DbOrTx } from "@/core/drizzle/drizzle.service";
import {
  AlertQueueRepository,
  type PendingEBirdAlert,
  type SubscriptionScope,
} from "./alert-queue.repository";

const MARK_SENT_BATCH_SIZE = 100;

export type { PendingEBirdAlert, SubscriptionScope };

export type SentAlert = {
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
   * Record alerts as sent. Idempotent (unique on kind+alertId+channelId);
   * owns the alertId format — callers never build it.
   */
  async markSent(alerts: SentAlert[]): Promise<void> {
    for (let i = 0; i < alerts.length; i += MARK_SENT_BATCH_SIZE) {
      const batch = alerts.slice(i, i + MARK_SENT_BATCH_SIZE).map((alert) => ({
        alertId: `${alert.speciesCode}:${alert.subId}`,
        channelId: alert.channelId,
        kind: "ebird" as const,
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
}
