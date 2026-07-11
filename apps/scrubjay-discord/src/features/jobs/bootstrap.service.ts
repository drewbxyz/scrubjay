import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { metrics } from "@opentelemetry/api";
import { AlertQueue } from "@/features/dispatch/alert-queue.service";
import { IngestService } from "@/features/ingest/ingest.service";
import { SourcesRepository } from "@/features/sources/sources.repository";

/**
 * Populates DB on startup without triggering any Discord messages.
 * Also coordinates with scheduled jobs to ensure bootstrap completes first.
 */
@Injectable()
export class BootstrapService implements OnModuleInit {
  private readonly alerts = metrics
    .getMeter("scrubjay-discord")
    .createCounter("scrubjay.dispatch.alerts", {
      description: "Alert delivery outcomes by status",
    });

  private readonly logger = new Logger(BootstrapService.name);

  private bootstrapPromise: Promise<void> | null = null;

  constructor(
    private readonly ingestService: IngestService,
    private readonly alertQueue: AlertQueue,
    private readonly sources: SourcesRepository,
  ) {}

  onModuleInit(): Promise<void> {
    this.bootstrapPromise ??= this.bootstrap();
    return this.bootstrapPromise;
  }

  /**
   * Wait for bootstrap to complete. Jobs call this before running.
   * Resolves once startup population finished; rejects if it failed — a
   * failed bootstrap must not unblock dispatch (B6). Nest awaits
   * onModuleInit before scheduled jobs register, so in production this
   * returns an already-settled promise; the seam stays explicit and testable.
   */
  waitForBootstrap(): Promise<void> {
    return this.bootstrapPromise ?? this.onModuleInit();
  }

  private async bootstrap(): Promise<void> {
    this.logger.log("Running startup population job...");

    const regions = await this.sources.getEBirdSources();

    for (const region of regions) {
      try {
        const count = await this.ingestService.ingestRegion(region);
        this.logger.log(`Populated ${count} observations for ${region}`);
      } catch (err) {
        this.logger.error(
          `Population failed for ${region}`,
          err instanceof Error ? err.stack : String(err),
        );
      }
    }

    // If recording pre-existing alerts fails, let bootstrap reject: a crashed
    // startup beats dispatching a burst of stale alerts (B6).
    const pending = await this.alertQueue.pendingEBirdAlerts();
    await this.alertQueue.record(pending, "suppressed");
    this.alerts.add(pending.length, { status: "suppressed" });
    this.logger.log(
      `Suppressed ${pending.length} pre-existing alerts (bootstrap mode).`,
    );

    this.logger.log("Startup population complete.");
  }
}
