import { Module } from "@nestjs/common";
import { DispatchModule } from "../dispatch/dispatch.module";
import { HealthModule } from "../health/health.module";
import { IngestModule } from "../ingest/ingest.module";
import { RetentionModule } from "../retention/retention.module";
import { SourcesModule } from "../sources/sources.module";
import { BootstrapService } from "./bootstrap.service";
import { DispatchJob } from "./dispatch.job";
import { IngestJob } from "./ingest.job";
import { RetentionJob } from "./retention.job";

@Module({
  imports: [
    DispatchModule,
    HealthModule,
    IngestModule,
    RetentionModule,
    SourcesModule,
  ],
  providers: [BootstrapService, DispatchJob, IngestJob, RetentionJob],
})
export class JobsModule {}
