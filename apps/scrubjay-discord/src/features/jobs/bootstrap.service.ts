import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { AlertQueue } from "@/features/dispatch/alert-queue.service";
import { EBirdService } from "@/features/ebird/ebird.service";
import { SourcesRepository } from "@/features/sources/sources.repository";

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
    private readonly alertQueue: AlertQueue,
    private readonly sources: SourcesRepository,
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
          reject(new Error("Bootstrap timed out after 5 minutes"));
        },
        5 * 60 * 1000,
      );
    });

    return this.bootstrapPromise;
  }

  async onModuleInit() {
    this.logger.log("Running startup population job...");

    const regions = await this.sources.getEBirdSources();

    for (const region of regions) {
      try {
        const count = await this.ebirdService.ingestRegion(region);
        this.logger.log(`Populated ${count} observations for ${region}`);
      } catch (err) {
        this.logger.error(`Population failed for ${region}: ${err}`);
      }
    }

    // If marking pre-existing alerts fails, let onModuleInit reject: a
    // crashed startup beats dispatching a burst of stale alerts (B6).
    const pending = await this.alertQueue.pendingEBirdAlerts();
    await this.alertQueue.markSent(pending);
    this.logger.log(
      `Marked ${pending.length} pre-existing alerts as sent (bootstrap mode).`,
    );

    this.logger.log("Startup population complete.");
    this.bootstrapComplete = true;
  }
}
