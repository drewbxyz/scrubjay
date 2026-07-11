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

  // Both are ObservableUpDownCounters on the same meter, so a single flush
  // (metricHarness.collectAll()) must observe them together: sequential
  // collect(name) calls would each trigger a fresh forceFlush that also
  // re-observes the *other* instrument, zeroing its delta on the second
  // read even though the pool state never changed. See otel-harness.ts.
  it("observes connection counts and pending requests in one flush", async () => {
    const metrics = await metricHarness.collectAll();
    const count = metrics.find(
      (metric) => metric.descriptor.name === "db.client.connection.count",
    );
    const pending = metrics.find(
      (metric) =>
        metric.descriptor.name === "db.client.connection.pending_requests",
    );

    const byState = Object.fromEntries(
      (count?.dataPoints ?? []).map((point) => [
        point.attributes.state,
        point.value,
      ]),
    );
    expect(byState).toEqual({ idle: 2, used: 3 });
    expect(pending?.dataPoints[0]?.value).toBe(1);
  });

  it("counts idle client errors", async () => {
    pool.emit("error", new Error("connection reset"));

    const errors = await metricHarness.collect("scrubjay.db.pool.errors");
    expect(errors?.dataPoints[0]?.value).toBe(1);
  });
});
