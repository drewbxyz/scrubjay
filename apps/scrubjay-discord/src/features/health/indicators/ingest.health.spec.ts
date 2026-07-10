import { HealthIndicatorService } from "@nestjs/terminus";
import { describe, expect, it } from "vitest";
import { HealthStateService } from "../health-state.service";
import { IngestHealthIndicator } from "./ingest.health";

describe("IngestHealthIndicator", () => {
  it("is always up and carries the ingest snapshot as details", () => {
    const state = new HealthStateService();
    state.recordIngestTick([]);
    const indicator = new IngestHealthIndicator(
      new HealthIndicatorService(),
      state,
    );

    const result = indicator.isHealthy("ingest");

    expect(result.ingest).toMatchObject({
      noSources: true,
      sources: [],
      status: "up",
    });
  });
});
