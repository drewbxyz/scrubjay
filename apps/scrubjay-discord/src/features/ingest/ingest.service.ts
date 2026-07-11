import { Injectable, Logger } from "@nestjs/common";
import { metrics } from "@opentelemetry/api";
import { EBirdFetcher } from "./ebird.fetcher";
import type { EBirdObservation } from "./ebird.schema";
import { EBirdTransformer } from "./ebird.transformer";
import { ObservationRepository } from "./observation.repository";

@Injectable()
export class IngestService {
  private readonly logger = new Logger(IngestService.name);

  private readonly records = metrics
    .getMeter("scrubjay-discord")
    .createCounter("scrubjay.ingest.records", {
      description: "eBird observations upserted per ingest, by region",
      unit: "{record}",
    });

  constructor(
    private readonly fetcher: EBirdFetcher,
    private readonly transformer: EBirdTransformer,
    private readonly repo: ObservationRepository,
  ) {}

  async ingestRegion(regionCode: string) {
    let rawObservations: EBirdObservation[];
    try {
      rawObservations = await this.fetcher.fetchRareObservations(regionCode);
      this.logger.log(
        `Fetched ${rawObservations.length} records from ${regionCode}`,
      );
    } catch (err) {
      this.logger.error(
        `Error fetching observations from ${regionCode}`,
        err instanceof Error ? err.stack : String(err),
      );
      return 0;
    }

    const batch = this.transformer.transformObservations(rawObservations);

    try {
      await this.repo.upsertObservations(batch);
    } catch (err) {
      this.logger.error(
        `Error persisting ${batch.length} observations from ${regionCode}`,
        err instanceof Error ? err.stack : String(err),
      );
      return 0;
    }

    this.records.add(batch.length, { region: regionCode });

    return batch.length;
  }
}
