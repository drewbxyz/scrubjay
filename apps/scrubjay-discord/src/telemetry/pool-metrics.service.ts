import { Inject, Injectable, type OnModuleInit } from "@nestjs/common";
import { metrics } from "@opentelemetry/api";
import type { Pool } from "pg";
import { PG_POOL } from "@/core/drizzle/pg-connection";

/**
 * Pool saturation gauges, observed lazily at each metric export. Query-level
 * errors are not counted here — instrumentation-pg already marks their spans.
 */
@Injectable()
export class PoolMetricsService implements OnModuleInit {
  private readonly meter = metrics.getMeter("scrubjay-discord");

  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  onModuleInit(): void {
    const connections = this.meter.createObservableUpDownCounter(
      "db.client.connection.count",
      { description: "Open pg pool connections by state" },
    );
    connections.addCallback((result) => {
      const idle = this.pool.idleCount;
      result.observe(this.pool.totalCount - idle, { state: "used" });
      result.observe(idle, { state: "idle" });
    });

    const pending = this.meter.createObservableUpDownCounter(
      "db.client.connection.pending_requests",
      { description: "Requests waiting for a pg pool connection" },
    );
    pending.addCallback((result) => {
      result.observe(this.pool.waitingCount);
    });

    const errors = this.meter.createCounter("scrubjay.db.pool.errors", {
      description: "Errors emitted by idle pg pool clients",
    });
    // Second listener alongside DrizzleModule's logging handler.
    this.pool.on("error", () => errors.add(1));
  }
}
