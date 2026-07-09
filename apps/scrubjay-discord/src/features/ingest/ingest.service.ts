import { Injectable, Logger } from "@nestjs/common";
import { EBirdFetcher } from "./ebird.fetcher";
import type { EBirdObservation } from "./ebird.schema";
import { EBirdTransformer } from "./ebird.transformer";
import { ObservationRepository } from "./observation.repository";

@Injectable()
export class IngestService {
  private readonly logger = new Logger(IngestService.name);

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
      this.logger.error(`Error fetching observations: ${err}`);
      return 0;
    }

    const transformedObservations =
      this.transformer.transformObservations(rawObservations);

    let insertedCount = 0;
    for (const obs of transformedObservations) {
      try {
        await this.repo.upsertObservation(obs);
        insertedCount++;
      } catch (_err) {
        this.logger.warn(
          `Failed to insert observation: ${obs.speciesCode}:${obs.subId}`,
        );
      }
    }

    return insertedCount;
  }
}
