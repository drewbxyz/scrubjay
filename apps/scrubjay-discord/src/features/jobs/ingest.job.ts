import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { HealthStateService } from "@/features/health/health-state.service";
import { IngestService } from "@/features/ingest/ingest.service";
import { SourcesRepository } from "@/features/sources/sources.repository";
import { BootstrapService } from "./bootstrap.service";

@Injectable()
export class IngestJob {
  private readonly logger = new Logger(IngestJob.name);

  constructor(
    private readonly ingest: IngestService,
    private readonly bootstrapService: BootstrapService,
    private readonly sources: SourcesRepository,
    private readonly healthState: HealthStateService,
  ) {}

  @Cron("*/15 * * * *")
  async run() {
    try {
      // Wait for bootstrap to complete before running
      await this.bootstrapService.waitForBootstrap();

      this.logger.debug("Starting eBird ingestion job...");

      const regions = await this.sources.getEBirdSources();
      this.healthState.recordIngestTick(regions);
      if (regions.length === 0) {
        // Zero subscriptions makes every tick a silent no-op; say so.
        this.logger.warn("No eBird sources configured; ingest is a no-op");
      }

      for (const region of regions) {
        try {
          const inserted = await this.ingest.ingestRegion(region);
          this.healthState.recordIngestSuccess(region);
          this.logger.log(`Region ${region}: ${inserted} alerts ingested`);
        } catch (err) {
          this.logger.error(
            `Failed to ingest ${region}`,
            err instanceof Error ? err.stack : String(err),
          );
        }
      }
    } catch (err) {
      this.logger.error(
        `Ingest tick failed`,
        err instanceof Error ? err.stack : String(err),
      );
    }
  }
}
