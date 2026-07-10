import { Injectable } from "@nestjs/common";
import { HealthIndicatorService } from "@nestjs/terminus";
import { sql } from "drizzle-orm";
import { DrizzleService } from "@/core/drizzle/drizzle.service";

/** The only indicator allowed to fail the check (spec decision 2). */
@Injectable()
export class DatabaseHealthIndicator {
  constructor(
    private readonly health: HealthIndicatorService,
    private readonly drizzle: DrizzleService,
  ) {}

  async isHealthy(key: string) {
    const indicator = this.health.check(key);
    try {
      // Pool-level connect/statement timeouts bound this; no extra timeout.
      await this.drizzle.db.execute(sql`select 1`);
      return indicator.up();
    } catch (err) {
      return indicator.down({
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
