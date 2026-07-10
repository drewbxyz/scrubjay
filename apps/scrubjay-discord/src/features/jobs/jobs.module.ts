import { Module } from "@nestjs/common";
import { DispatchModule } from "../dispatch/dispatch.module";
import { IngestModule } from "../ingest/ingest.module";
import { SourcesModule } from "../sources/sources.module";
import { BootstrapService } from "./bootstrap.service";
import { DispatchJob } from "./dispatch.job";
import { IngestJob } from "./ingest.job";

@Module({
  imports: [IngestModule, DispatchModule, SourcesModule],
  providers: [BootstrapService, IngestJob, DispatchJob],
})
export class JobsModule {}
