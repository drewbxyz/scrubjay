import { HealthIndicatorService } from "@nestjs/terminus";
import { describe, expect, it, vi } from "vitest";
import type { HealthRepository } from "../health.repository";
import { HealthStateService } from "../health-state.service";
import { DispatchHealthIndicator } from "./dispatch.health";

describe("DispatchHealthIndicator", () => {
  it("is up with last tick and 24h outcome counts as details", async () => {
    const state = new HealthStateService();
    state.recordDispatchTick();
    const counts = { expired: 0, failed: 1, sent: 5, suppressed: 2 };
    const repository = {
      recentDeliveryCounts: vi.fn().mockResolvedValue(counts),
    };
    const indicator = new DispatchHealthIndicator(
      new HealthIndicatorService(),
      state,
      repository as unknown as HealthRepository,
    );

    const result = await indicator.isHealthy("dispatch");

    expect(result.dispatch).toMatchObject({
      last24h: counts,
      status: "up",
    });
    expect(result.dispatch?.lastTickAt).toEqual(expect.any(String));
  });

  it("is still up when recentDeliveryCounts rejects", async () => {
    const state = new HealthStateService();
    const repository = {
      recentDeliveryCounts: vi.fn().mockRejectedValue(new Error("db down")),
    };
    const indicator = new DispatchHealthIndicator(
      new HealthIndicatorService(),
      state,
      repository as unknown as HealthRepository,
    );

    const result = await indicator.isHealthy("dispatch");

    expect(result.dispatch).toMatchObject({
      countsError: expect.any(String),
      last24h: null,
      status: "up",
    });
  });
});
