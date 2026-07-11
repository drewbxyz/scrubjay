import { afterAll, describe, expect, it } from "vitest";
import { registerMetricHarness } from "@/testing/otel-harness";
import { LifecycleUpdate } from "./lifecycle.update";

const metricHarness = registerMetricHarness();

describe("LifecycleUpdate gateway metrics", () => {
  afterAll(async () => {
    await metricHarness.shutdown();
  });

  it("counts reconnecting and resume events separately", async () => {
    const lifecycle = new LifecycleUpdate();

    lifecycle.onShardReconnecting();
    lifecycle.onShardReconnecting();
    lifecycle.onShardResume();

    const reconnects = await metricHarness.collect(
      "scrubjay.discord.gateway.reconnects",
    );
    const byEvent = Object.fromEntries(
      (reconnects?.dataPoints ?? []).map((point) => [
        point.attributes.event,
        point.value,
      ]),
    );
    expect(byEvent).toEqual({ reconnecting: 2, resume: 1 });
  });
});
