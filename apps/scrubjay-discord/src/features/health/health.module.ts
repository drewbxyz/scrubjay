import { Module } from "@nestjs/common";
import { TerminusModule } from "@nestjs/terminus";
import { HealthCommands } from "./health.commands";
import { HealthController } from "./health.controller";
import { HealthRepository } from "./health.repository";
import { HealthStateService } from "./health-state.service";
import { DatabaseHealthIndicator } from "./indicators/database.health";
import { DispatchHealthIndicator } from "./indicators/dispatch.health";
import { IngestHealthIndicator } from "./indicators/ingest.health";

@Module({
  controllers: [HealthController],
  exports: [HealthStateService],
  imports: [TerminusModule],
  providers: [
    DatabaseHealthIndicator,
    DispatchHealthIndicator,
    HealthCommands,
    HealthRepository,
    HealthStateService,
    IngestHealthIndicator,
  ],
})
export class HealthModule {}
