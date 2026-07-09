import { Injectable, Logger } from "@nestjs/common";
import { MessageSenderService } from "@/discord/message-sender.service";
import {
  AlertQueue,
  type PendingEBirdAlert,
  type SentAlert,
} from "./alert-queue.service";
import { planEBirdAlerts } from "./ebird-alert.formatter";

/**
 * The Dispatch pipeline: turns pending alerts into Discord embeds and
 * records deliveries. Owns the send-then-record protocol for every alert
 * kind — a failed send is NOT recorded, so the alert stays pending and
 * retries until it ages out of the dispatch window (at-least-once).
 */
@Injectable()
export class DispatchService {
  private readonly logger = new Logger(DispatchService.name);

  constructor(
    private readonly alertQueue: AlertQueue,
    private readonly sender: MessageSenderService,
  ) {}

  async dispatchSince(since: Date): Promise<void> {
    const pending = await this.alertQueue.pendingEBirdAlerts(since);

    if (pending.length === 0) {
      this.logger.debug(`No new alerts since ${since.toISOString()}`);
      return;
    }

    const sent: SentAlert[] = [];

    for (const plan of planEBirdAlerts(pending)) {
      try {
        await this.sender.send(plan.channelId, plan.message);
        sent.push(...plan.alerts.map(toSentAlert));
      } catch (err) {
        this.logger.error(
          `Send failed for channel ${plan.channelId}; alerts stay pending: ${err}`,
        );
      }
    }

    await this.alertQueue.markSent(sent);

    if (sent.length > 0) {
      this.logger.log(`Marked ${sent.length} alerts as delivered`);
    }
  }
}

function toSentAlert(alert: PendingEBirdAlert): SentAlert {
  return {
    channelId: alert.channelId,
    speciesCode: alert.speciesCode,
    subId: alert.subId,
  };
}
