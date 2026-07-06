import { Module } from "@nestjs/common";
import { ScheduleModule } from "@nestjs/schedule";
import { DispatchModule } from "../dispatch/dispatch.module";
import { EBirdModule } from "../ebird/ebird.module";
import { SourcesModule } from "../sources/sources.module";
import { BootstrapService } from "./bootstrap.service";
import { DispatchJob } from "./dispatch.job";
import { EBirdIngestJob } from "./ebird-ingest.job";

@Module({
  imports: [EBirdModule, ScheduleModule, DispatchModule, SourcesModule],
  providers: [BootstrapService, EBirdIngestJob, DispatchJob],
})
export class JobsModule {}
