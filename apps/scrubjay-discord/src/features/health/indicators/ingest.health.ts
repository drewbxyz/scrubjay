import { Injectable } from "@nestjs/common";
import { HealthIndicatorService } from "@nestjs/terminus";
import { HealthStateService } from "../health-state.service";

/**
 * Always "up": ingest staleness must never 503 the check — a container
 * restart cannot fix an eBird outage (spec decision 2). Details carry the
 * freshness data for humans and `docker inspect`.
 */
@Injectable()
export class IngestHealthIndicator {
  constructor(
    private readonly health: HealthIndicatorService,
    private readonly state: HealthStateService,
  ) {}

  isHealthy(key: string) {
    return this.health.check(key).up(this.state.snapshot().ingest);
  }
}
