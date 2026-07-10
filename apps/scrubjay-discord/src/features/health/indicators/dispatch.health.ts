import { Injectable } from "@nestjs/common";
import { HealthIndicatorService } from "@nestjs/terminus";
import { HealthStateService } from "../health-state.service";
import { HealthRepository } from "../health.repository";

/**
 * Always "up" by design; the DB query can still throw, but in that scenario
 * the database indicator already fails the check (spec §3 caveat).
 */
@Injectable()
export class DispatchHealthIndicator {
  constructor(
    private readonly health: HealthIndicatorService,
    private readonly state: HealthStateService,
    private readonly repository: HealthRepository,
  ) {}

  async isHealthy(key: string) {
    const last24h = await this.repository.recentDeliveryCounts();
    return this.health.check(key).up({
      ...this.state.snapshot().dispatch,
      last24h,
    });
  }
}
