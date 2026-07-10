import { Injectable } from "@nestjs/common";
import { HealthIndicatorService } from "@nestjs/terminus";
import { HealthRepository } from "../health.repository";
import { HealthStateService } from "../health-state.service";

/**
 * Always "up" by design; if the delivery-counts query throws, this indicator
 * catches the error itself and still reports up (spec §3 caveat) so that a
 * DB outage is surfaced solely by the database indicator.
 */
@Injectable()
export class DispatchHealthIndicator {
  constructor(
    private readonly health: HealthIndicatorService,
    private readonly state: HealthStateService,
    private readonly repository: HealthRepository,
  ) {}

  async isHealthy(key: string) {
    const indicator = this.health.check(key);
    try {
      const last24h = await this.repository.recentDeliveryCounts();
      return indicator.up({ ...this.state.snapshot().dispatch, last24h });
    } catch (err) {
      // Never fail the check from here; a DB outage is the database
      // indicator's job to surface. Report up with the count query's error.
      return indicator.up({
        ...this.state.snapshot().dispatch,
        countsError: err instanceof Error ? err.message : String(err),
        last24h: null,
      });
    }
  }
}
