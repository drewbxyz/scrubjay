import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { DeliveriesService } from "@/features/deliveries/deliveries.service";
import { EBirdDispatcherService } from "@/features/dispatcher/dispatchers/ebird-dispatcher.service";
import { EBirdService } from "@/features/ebird/ebird.service";
import { SourcesService } from "@/features/sources/sources.service";

/**
 * Populates DB on startup without triggering any Discord messages.
 * Also coordinates with scheduled jobs to ensure bootstrap completes first.
 */
@Injectable()
export class BootstrapService implements OnModuleInit {
  private readonly logger = new Logger(BootstrapService.name);

  private bootstrapComplete = false;
  private bootstrapPromise: Promise<void> | null = null;

  constructor(
    private readonly ebirdService: EBirdService,
    private readonly ebirdDispatcher: EBirdDispatcherService,
    private readonly deliveries: DeliveriesService,
    private readonly sources: SourcesService,
  ) {}

  /**
   * Wait for bootstrap to complete. Jobs should call this before running.
   */
  async waitForBootstrap(): Promise<void> {
    if (this.bootstrapComplete) {
      return;
    }

    if (this.bootstrapPromise) {
      return this.bootstrapPromise;
    }

    // Wait up to 5 minutes for bootstrap to complete
    this.bootstrapPromise = new Promise<void>((resolve, reject) => {
      const checkInterval = setInterval(() => {
        if (this.bootstrapComplete) {
          clearInterval(checkInterval);
          resolve();
        }
      }, 100);

      setTimeout(
        () => {
          clearInterval(checkInterval);
          if (!this.bootstrapComplete) {
            this.logger.warn(
              "Bootstrap did not complete within timeout, rejecting attempt",
            );
          }
          reject();
        },
        5 * 60 * 1000,
      );
    });

    return this.bootstrapPromise;
  }

  async onModuleInit() {
    this.logger.log("Running startup population job...");

    const regions = await this.sources.getEBirdSources();

    try {
      for (const region of regions) {
        try {
          const count = await this.ebirdService.ingestRegion(region);
          this.logger.log(`Populated ${count} observations for ${region}`);
        } catch (err) {
          this.logger.error(`Population failed for ${region}: ${err}`);
        }
      }

      const undelivered = await this.ebirdDispatcher.getUndeliveredSinceDate();
      await this.deliveries.recordDeliveries(
        undelivered.map((obs) => ({
          alertId: `${obs.speciesCode}:${obs.subId}`,
          alertKind: "ebird" as const,
          channelId: obs.channelId,
        })),
      );
      this.logger.log(
        `Marked ${undelivered.length} deliveries as sent (bootstrap mode).`,
      );

      this.logger.log("Startup population complete.");
    } finally {
      // Always mark bootstrap as complete, even if there were errors
      this.bootstrapComplete = true;
    }
  }
}
