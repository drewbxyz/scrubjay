import { Module } from "@nestjs/common";
import { EBirdFetcher } from "./ebird.fetcher";
import { EBirdTransformer } from "./ebird.transformer";
import { IngestService } from "./ingest.service";
import { ObservationRepository } from "./observation.repository";

@Module({
  exports: [IngestService],
  imports: [],
  providers: [EBirdFetcher, EBirdTransformer, IngestService, ObservationRepository],
})
export class IngestModule {}
