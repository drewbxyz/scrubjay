import { Injectable, Logger } from "@nestjs/common";
import { metrics } from "@opentelemetry/api";
import { MessageSenderService } from "@/discord/message-sender.service";
import {
  AlertQueue,
  type AlertRef,
  type PendingEBirdAlert,
} from "./alert-queue.service";
import { classifySendError } from "./discord-error";
import { planEBirdAlerts } from "./ebird-alert.formatter";

/** Sweep scan floor — matches the eBird fetch lookback (back=7). */
const SWEEP_FLOOR_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * The Dispatch pipeline: turns pending alerts into Discord embeds and
 * records deliveries. Owns the send-then-record protocol for every alert
 * kind — a failed send is NOT recorded, so the alert stays pending and
 * retries until it ages out of the dispatch window (at-least-once).
 */
@Injectable()
export class DispatchService {
  private readonly queueDepth = metrics
    .getMeter("scrubjay-discord")
    .createGauge("scrubjay.dispatch.queue.depth", {
      description: "Pending alerts at the start of each dispatch tick",
    });

  private readonly alerts = metrics
    .getMeter("scrubjay-discord")
    .createCounter("scrubjay.dispatch.alerts", {
      description: "Alert delivery outcomes by status",
    });

  private readonly logger = new Logger(DispatchService.name);

  constructor(
    private readonly alertQueue: AlertQueue,
    private readonly sender: MessageSenderService,
  ) {}

  async dispatchSince(since: Date): Promise<void> {
    const pending = await this.alertQueue.pendingEBirdAlerts(since);

    this.queueDepth.record(pending.length);

    if (pending.length === 0) {
      this.logger.debug(`No new alerts since ${since.toISOString()}`);
    }

    let sentCount = 0;
    for (const plan of planEBirdAlerts(pending)) {
      const refs = plan.alerts.map(toAlertRef);
      try {
        await this.sender.send(plan.channelId, plan.message);
        // Record immediately: a crash now loses at most this one plan's
        // records instead of the whole tick's (at-least-once, spec §2).
        await this.alertQueue.record(refs, "sent");
        this.alerts.add(refs.length, { status: "sent" });
        sentCount += refs.length;
      } catch (err) {
        await this.handleSendFailure(plan.channelId, refs, err);
      }
    }

    if (sentCount > 0) {
      this.logger.log(`Delivered ${sentCount} alerts`);
    }

    // Alert-loss closure (spec §4): anything that aged out of the dispatch
    // window without an outcome gets an 'expired' row and a warning.
    const expired = await this.alertQueue.sweepExpired(
      since,
      new Date(since.getTime() - SWEEP_FLOOR_MS),
    );
    for (const alert of expired) {
      this.logger.warn(
        `Alert ${alert.alertId} (${alert.comName}) for channel ${alert.channelId} expired unsent`,
      );
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
      this.alerts.add(refs.length, { status: "transient" });
      return;
    }

    await this.alertQueue.record(refs, "failed", `discord:${failure.code}`);
    this.alerts.add(refs.length, { status: "failed" });
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
