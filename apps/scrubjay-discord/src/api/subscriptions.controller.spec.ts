import { BadRequestException, NotFoundException } from "@nestjs/common";
import { listSubscriptionsResponseSchema } from "@scrubjay/api-contracts";
import { describe, expect, it, vi } from "vitest";
import { InvalidRegionError } from "@/features/subscriptions/invalid-region.error";
import type { SubscriptionsRepository } from "@/features/subscriptions/subscriptions.repository";
import type { SubscriptionsService } from "@/features/subscriptions/subscriptions.service";
import type { GuildsService } from "./guilds.service";
import { SubscriptionsController } from "./subscriptions.controller";

const row = {
  active: true,
  channelId: "CH1",
  countyCode: "*",
  lastUpdated: new Date("2026-07-13T00:00:00.000Z"),
  stateCode: "US-CA",
};

function build(overrides: {
  guilds?: Partial<GuildsService>;
  repo?: Partial<SubscriptionsRepository>;
  service?: Partial<SubscriptionsService>;
}) {
  return new SubscriptionsController(
    overrides.repo as SubscriptionsRepository,
    overrides.service as SubscriptionsService,
    (overrides.guilds ?? {
      isPostableChannel: async () => true,
    }) as GuildsService,
  );
}

describe("SubscriptionsController", () => {
  it("lists subscriptions in the contract wire shape", async () => {
    const controller = build({
      repo: { listSubscriptions: vi.fn().mockResolvedValue([row]) },
    });
    const result = await controller.list({});
    const parsed = listSubscriptionsResponseSchema.parse(
      JSON.parse(JSON.stringify(result)),
    );
    expect(parsed.subscriptions[0]?.channelId).toBe("CH1");
  });

  it("creates via SubscriptionsService and reports created=false on dupes", async () => {
    const subscribe = vi.fn().mockResolvedValue(false);
    const controller = build({ service: { subscribe } });
    const result = await controller.create({
      channelId: "CH1",
      regionCode: "us-ca",
    });
    expect(subscribe).toHaveBeenCalledWith("CH1", "us-ca");
    expect(result).toEqual({ created: false });
  });

  it("rejects a create for a channel the bot cannot post to", async () => {
    const subscribe = vi.fn();
    const controller = build({
      guilds: { isPostableChannel: async () => false },
      service: { subscribe },
    });
    await expect(
      controller.create({ channelId: "BOGUS", regionCode: "US-CA" }),
    ).rejects.toThrow(BadRequestException);
    expect(subscribe).not.toHaveBeenCalled();
  });

  it("maps InvalidRegionError to a 400 INVALID_REGION", async () => {
    const controller = build({
      service: {
        subscribe: vi.fn().mockRejectedValue(new InvalidRegionError("nope")),
      },
    });
    await expect(
      controller.create({ channelId: "CH1", regionCode: "nope" }),
    ).rejects.toThrow(BadRequestException);
  });

  it("404s a PATCH against a missing composite key", async () => {
    const controller = build({
      repo: { setSubscriptionActive: vi.fn().mockResolvedValue(false) },
    });
    await expect(
      controller.update({
        active: false,
        channelId: "CH1",
        countyCode: "*",
        stateCode: "US-CA",
      }),
    ).rejects.toThrow(NotFoundException);
  });

  it("deletes via SubscriptionsService.unsubscribe using the county code as region", async () => {
    const unsubscribe = vi.fn().mockResolvedValue(true);
    const controller = build({ service: { unsubscribe } });
    await controller.remove({
      channelId: "CH1",
      countyCode: "US-CA-085",
      stateCode: "US-CA",
    });
    expect(unsubscribe).toHaveBeenCalledWith("CH1", "US-CA-085");
  });

  it("deletes a statewide subscription via the state code", async () => {
    const unsubscribe = vi.fn().mockResolvedValue(true);
    const controller = build({ service: { unsubscribe } });
    await controller.remove({
      channelId: "CH1",
      countyCode: "*",
      stateCode: "US-CA",
    });
    expect(unsubscribe).toHaveBeenCalledWith("CH1", "US-CA");
  });

  it("maps InvalidRegionError from unsubscribe to a 400 INVALID_REGION", async () => {
    const controller = build({
      service: {
        unsubscribe: vi.fn().mockRejectedValue(new InvalidRegionError("nope")),
      },
    });
    await expect(
      controller.remove({
        channelId: "CH1",
        countyCode: "bogus",
        stateCode: "US-CA",
      }),
    ).rejects.toThrow(BadRequestException);
  });
});
