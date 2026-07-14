import { regionsResponseSchema } from "@scrubjay/api-contracts";
import { describe, expect, it, vi } from "vitest";
import type { AlertQueue } from "@/features/dispatch/alert-queue.service";
import type { SubscriptionsRepository } from "@/features/subscriptions/subscriptions.repository";
import { OpsController } from "./ops.controller";
import type { OpsRepository } from "./ops.repository";

const sub = (stateCode: string, channelId: string) => ({
  active: true,
  channelId,
  countyCode: "*",
  lastUpdated: new Date("2026-07-13T00:00:00.000Z"),
  stateCode,
});

describe("OpsController", () => {
  it("groups subscriptions into regions by state", async () => {
    const subsRepo = {
      listSubscriptions: vi
        .fn()
        .mockResolvedValue([
          sub("US-AZ", "CH2"),
          sub("US-CA", "CH1"),
          sub("US-CA", "CH3"),
        ]),
    } as unknown as SubscriptionsRepository;
    const controller = new OpsController(
      {} as AlertQueue,
      {} as OpsRepository,
      subsRepo,
    );
    const result = await controller.regions();
    const parsed = regionsResponseSchema.parse(
      JSON.parse(JSON.stringify(result)),
    );
    expect(parsed.regions.map((r) => r.stateCode)).toEqual(["US-AZ", "US-CA"]);
    expect(parsed.regions[1]?.subscriptions).toHaveLength(2);
  });

  it("serves pending alerts through the AlertQueue", async () => {
    const pendingEBirdAlerts = vi.fn().mockResolvedValue([]);
    const controller = new OpsController(
      { pendingEBirdAlerts } as unknown as AlertQueue,
      {} as OpsRepository,
      {} as SubscriptionsRepository,
    );
    expect(await controller.pendingAlerts()).toEqual({ alerts: [] });
    expect(pendingEBirdAlerts).toHaveBeenCalledWith();
  });
});
