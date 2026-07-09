import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
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
  ) {}

  @Cron("*/15 * * * *")
  async run() {
    try {
      // Wait for bootstrap to complete before running
      await this.bootstrapService.waitForBootstrap();

      this.logger.debug("Starting eBird ingestion job...");

      const regions = await this.sources.getEBirdSources();

      for (const region of regions) {
        try {
          const inserted = await this.ingest.ingestRegion(region);
          this.logger.log(`Region ${region}: ${inserted} alerts ingested`);
        } catch (err) {
          this.logger.error(`Failed to ingest ${region}: ${err}`);
        }
      }
    } catch (err) {
      this.logger.error(`Ingest tick failed: ${err}`);
    }
  }
}
