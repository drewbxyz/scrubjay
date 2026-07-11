import { Inject, Injectable, type OnModuleInit } from "@nestjs/common";
import { metrics } from "@opentelemetry/api";
import type { Pool } from "pg";
import { PG_POOL } from "@/core/drizzle/pg-connection";

/**
 * Pool error counter. Connection-count and pending-request gauges are emitted
 * by instrumentation-pg (db.client.connection.count / .pending_requests, split
 * by db.client.connection.state and pool.name), so re-observing them here would
 * only duplicate those series under a bare `state` label. Query-level errors
 * are not counted here — instrumentation-pg already marks their spans.
 */
@Injectable()
export class PoolMetricsService implements OnModuleInit {
  private readonly meter = metrics.getMeter("scrubjay-discord");

  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  onModuleInit(): void {
    const errors = this.meter.createCounter("scrubjay.db.pool.errors", {
      description: "Errors emitted by idle pg pool clients",
    });
    // Second listener alongside DrizzleModule's logging handler.
    this.pool.on("error", () => errors.add(1));
  }
}
