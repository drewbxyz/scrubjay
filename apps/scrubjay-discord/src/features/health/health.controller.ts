import { Controller, Get } from "@nestjs/common";
import { HealthCheck, HealthCheckService } from "@nestjs/terminus";
import { DatabaseHealthIndicator } from "./indicators/database.health";
import { DispatchHealthIndicator } from "./indicators/dispatch.health";
import { IngestHealthIndicator } from "./indicators/ingest.health";

@Controller("health")
export class HealthController {
  constructor(
    private readonly database: DatabaseHealthIndicator,
    private readonly dispatch: DispatchHealthIndicator,
    private readonly health: HealthCheckService,
    private readonly ingest: IngestHealthIndicator,
  ) {}

  @Get()
  @HealthCheck()
  check() {
    return this.health.check([
      () => this.database.isHealthy("database"),
      () => this.ingest.isHealthy("ingest"),
      () => this.dispatch.isHealthy("dispatch"),
    ]);
  }
}
