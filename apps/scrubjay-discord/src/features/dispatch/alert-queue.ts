import { Injectable } from "@nestjs/common";
import {
  AlertQueueRepository,
  type PendingEBirdAlert,
} from "./alert-queue.repository";

const MARK_SENT_BATCH_SIZE = 100;

export type { PendingEBirdAlert };

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
}
