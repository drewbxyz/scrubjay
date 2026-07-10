import { beforeEach, describe, expect, it, vi } from "vitest";
import { InvalidRegionError } from "./invalid-region.error";
import type { SubscriptionsRepository } from "./subscriptions.repository";
import { SubscriptionsService } from "./subscriptions.service";

describe("SubscriptionsService", () => {
  let service: SubscriptionsService;

  const repoMock = {
    deleteSubscription: vi.fn(),
    insertSubscription: vi.fn(),
    subscriptionsForChannel: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    service = new SubscriptionsService(
      repoMock as unknown as SubscriptionsRepository,
    );
  });

  describe("subscribe", () => {
    it("successfully subscribes to a state-level region (2 parts)", async () => {
      repoMock.insertSubscription.mockResolvedValue(undefined);

      await service.subscribe("channel-123", "US-WA");

      expect(repoMock.insertSubscription).toHaveBeenCalledWith({
        channelId: "channel-123",
        countyCode: "*",
        stateCode: "US-WA",
      });
    });

    it("successfully subscribes to a county-level region (3 parts)", async () => {
      repoMock.insertSubscription.mockResolvedValue(undefined);

      await service.subscribe("channel-123", "US-WA-033");

      expect(repoMock.insertSubscription).toHaveBeenCalledWith({
        channelId: "channel-123",
        countyCode: "US-WA-033",
        stateCode: "US-WA",
      });
    });

    it("normalizes a lowercase region code to uppercase", async () => {
      repoMock.insertSubscription.mockResolvedValue(undefined);

      await service.subscribe("channel-123", "us-wa-033");

      expect(repoMock.insertSubscription).toHaveBeenCalledWith({
        channelId: "channel-123",
        countyCode: "US-WA-033",
        stateCode: "US-WA",
      });
    });

    it("trims surrounding whitespace before validating", async () => {
      repoMock.insertSubscription.mockResolvedValue(undefined);

      await service.subscribe("channel-123", "  US-CA  ");

      expect(repoMock.insertSubscription).toHaveBeenCalledWith({
        channelId: "channel-123",
        countyCode: "*",
        stateCode: "US-CA",
      });
    });

    it("rejects a 1-part region code with InvalidRegionError", async () => {
      await expect(service.subscribe("channel-123", "US")).rejects.toThrow(
        InvalidRegionError,
      );

      expect(repoMock.insertSubscription).not.toHaveBeenCalled();
    });

    it.each([
      "US-C?A",
      "US-CA/..",
      "US-CA-085-",
      "U1-CA",
      "US--CA",
    ])("rejects a region code with illegal characters: %s", async (region) => {
      await expect(service.subscribe("channel-123", region)).rejects.toThrow(
        InvalidRegionError,
      );

      expect(repoMock.insertSubscription).not.toHaveBeenCalled();
    });

    it("rejects a 4-part region code, naming the code", async () => {
      await expect(
        service.subscribe("channel-123", "US-WA-033-EXTRA"),
      ).rejects.toThrow("Invalid region code: US-WA-033-EXTRA");

      expect(repoMock.insertSubscription).not.toHaveBeenCalled();
    });

    it("rejects an empty region code", async () => {
      await expect(service.subscribe("channel-123", "")).rejects.toThrow(
        InvalidRegionError,
      );

      expect(repoMock.insertSubscription).not.toHaveBeenCalled();
    });

    it("lets repository errors propagate unwrapped", async () => {
      repoMock.insertSubscription.mockRejectedValue(
        new Error("Database connection failed"),
      );

      await expect(service.subscribe("channel-123", "US-WA")).rejects.toThrow(
        "Database connection failed",
      );
    });

    it("handles various state codes correctly", async () => {
      repoMock.insertSubscription.mockResolvedValue(undefined);

      await service.subscribe("channel-123", "US-CA");
      await service.subscribe("channel-123", "US-NY");

      expect(repoMock.insertSubscription).toHaveBeenNthCalledWith(1, {
        channelId: "channel-123",
        countyCode: "*",
        stateCode: "US-CA",
      });
      expect(repoMock.insertSubscription).toHaveBeenNthCalledWith(2, {
        channelId: "channel-123",
        countyCode: "*",
        stateCode: "US-NY",
      });
    });

    it("handles various county codes correctly", async () => {
      repoMock.insertSubscription.mockResolvedValue(undefined);

      await service.subscribe("channel-123", "US-CA-037");

      expect(repoMock.insertSubscription).toHaveBeenCalledWith({
        channelId: "channel-123",
        countyCode: "US-CA-037",
        stateCode: "US-CA",
      });
    });
  });

  describe("unsubscribe", () => {
    it("deletes the parsed region and returns whether one existed", async () => {
      repoMock.deleteSubscription.mockResolvedValue(true);

      const removed = await service.unsubscribe("channel-123", "US-WA-033");

      expect(removed).toBe(true);
      expect(repoMock.deleteSubscription).toHaveBeenCalledWith({
        channelId: "channel-123",
        countyCode: "US-WA-033",
        stateCode: "US-WA",
      });
    });

    it("reports false when nothing was subscribed", async () => {
      repoMock.deleteSubscription.mockResolvedValue(false);

      expect(await service.unsubscribe("channel-123", "US-WA")).toBe(false);
      expect(repoMock.deleteSubscription).toHaveBeenCalledWith({
        channelId: "channel-123",
        countyCode: "*",
        stateCode: "US-WA",
      });
    });

    it("rejects an invalid region without touching the repository", async () => {
      await expect(service.unsubscribe("channel-123", "US")).rejects.toThrow(
        InvalidRegionError,
      );

      expect(repoMock.deleteSubscription).not.toHaveBeenCalled();
    });
  });

  describe("listSubscriptions", () => {
    it("returns the channel's rows from the repository", async () => {
      const rows = [{ countyCode: "US-MA-017", stateCode: "US-MA" }];
      repoMock.subscriptionsForChannel.mockResolvedValue(rows);

      const result = await service.listSubscriptions("channel-123");

      expect(result).toBe(rows);
      expect(repoMock.subscriptionsForChannel).toHaveBeenCalledWith(
        "channel-123",
      );
    });
  });
});
