import { Injectable, Logger } from "@nestjs/common";
import { MessageSenderService } from "@/discord/message-sender.service";
import {
  AlertQueue,
  type AlertRef,
  type PendingEBirdAlert,
} from "./alert-queue.service";
import { classifySendError } from "./discord-error";
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

    let sentCount = 0;
    for (const plan of planEBirdAlerts(pending)) {
      const refs = plan.alerts.map(toAlertRef);
      try {
        await this.sender.send(plan.channelId, plan.message);
        // Record immediately: a crash now loses at most this one plan's
        // records instead of the whole tick's (at-least-once, spec §2).
        await this.alertQueue.record(refs, "sent");
        sentCount += refs.length;
      } catch (err) {
        await this.handleSendFailure(plan.channelId, refs, err);
      }
    }

    if (sentCount > 0) {
      this.logger.log(`Delivered ${sentCount} alerts`);
    }
  }

  private async handleSendFailure(
    channelId: string,
    refs: AlertRef[],
    err: unknown,
  ): Promise<void> {
    const failure = classifySendError(err);
    if (failure.kind === "transient") {
      this.logger.error(
        `Send failed for channel ${channelId}; alerts stay pending`,
        err instanceof Error ? err.stack : String(err),
      );
      return;
    }

    await this.alertQueue.record(refs, "failed", `discord:${failure.code}`);
    if (failure.channelGone) {
      const count = await this.alertQueue.deactivateChannel(channelId);
      this.logger.error(
        `Channel ${channelId} no longer exists; recorded ${refs.length} alerts as failed and deactivated ${count} subscription(s)`,
      );
    } else {
      this.logger.error(
        `Send permanently failed for channel ${channelId} (discord:${failure.code}); recorded ${refs.length} alerts as failed`,
      );
    }
  }
}

function toAlertRef(alert: PendingEBirdAlert): AlertRef {
  return {
    channelId: alert.channelId,
    speciesCode: alert.speciesCode,
    subId: alert.subId,
  };
}
