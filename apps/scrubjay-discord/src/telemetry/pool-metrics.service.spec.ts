import { EventEmitter } from "node:events";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { registerMetricHarness } from "@/testing/otel-harness";
import { PoolMetricsService } from "./pool-metrics.service";

const metricHarness = registerMetricHarness();

class FakePool extends EventEmitter {
  idleCount = 2;
  totalCount = 5;
  waitingCount = 1;
}

describe("PoolMetricsService", () => {
  const pool = new FakePool();

  beforeAll(() => {
    const service = new PoolMetricsService(pool as unknown as Pool);
    service.onModuleInit();
  });

  afterAll(async () => {
    await metricHarness.shutdown();
  });

  // Connection-count and pending-request gauges come from instrumentation-pg;
  // this service only owns the error counter.
  it("counts idle client errors", async () => {
    pool.emit("error", new Error("connection reset"));

    const errors = await metricHarness.collect("scrubjay.db.pool.errors");
    expect(errors?.dataPoints[0]?.value).toBe(1);
  });
});
