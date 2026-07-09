import { InvalidRegionError } from "../invalid-region.error";
import type { SubscriptionsRepository } from "../subscriptions.repository";
import { SubscriptionsService } from "../subscriptions.service";

describe("SubscriptionsService", () => {
  let service: SubscriptionsService;

  const repoMock = {
    insertEBirdSubscription: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new SubscriptionsService(
      repoMock as unknown as SubscriptionsRepository,
    );
  });

  describe("subscribeToEBird", () => {
    it("successfully subscribes to a state-level region (2 parts)", async () => {
      repoMock.insertEBirdSubscription.mockResolvedValue(undefined);

      await service.subscribeToEBird("channel-123", "US-WA");

      expect(repoMock.insertEBirdSubscription).toHaveBeenCalledWith({
        channelId: "channel-123",
        countyCode: "*",
        stateCode: "US-WA",
      });
    });

    it("successfully subscribes to a county-level region (3 parts)", async () => {
      repoMock.insertEBirdSubscription.mockResolvedValue(undefined);

      await service.subscribeToEBird("channel-123", "US-WA-033");

      expect(repoMock.insertEBirdSubscription).toHaveBeenCalledWith({
        channelId: "channel-123",
        countyCode: "US-WA-033",
        stateCode: "US-WA",
      });
    });

    it("rejects a 1-part region code with InvalidRegionError", async () => {
      await expect(
        service.subscribeToEBird("channel-123", "US"),
      ).rejects.toThrow(InvalidRegionError);

      expect(repoMock.insertEBirdSubscription).not.toHaveBeenCalled();
    });

    it("rejects a 4-part region code, naming the code", async () => {
      await expect(
        service.subscribeToEBird("channel-123", "US-WA-033-EXTRA"),
      ).rejects.toThrow("Invalid region code: US-WA-033-EXTRA");

      expect(repoMock.insertEBirdSubscription).not.toHaveBeenCalled();
    });

    it("rejects an empty region code", async () => {
      await expect(service.subscribeToEBird("channel-123", "")).rejects.toThrow(
        InvalidRegionError,
      );

      expect(repoMock.insertEBirdSubscription).not.toHaveBeenCalled();
    });

    it("lets repository errors propagate unwrapped", async () => {
      repoMock.insertEBirdSubscription.mockRejectedValue(
        new Error("Database connection failed"),
      );

      await expect(
        service.subscribeToEBird("channel-123", "US-WA"),
      ).rejects.toThrow("Database connection failed");
    });

    it("handles various state codes correctly", async () => {
      repoMock.insertEBirdSubscription.mockResolvedValue(undefined);

      await service.subscribeToEBird("channel-123", "US-CA");
      await service.subscribeToEBird("channel-123", "US-NY");

      expect(repoMock.insertEBirdSubscription).toHaveBeenNthCalledWith(1, {
        channelId: "channel-123",
        countyCode: "*",
        stateCode: "US-CA",
      });
      expect(repoMock.insertEBirdSubscription).toHaveBeenNthCalledWith(2, {
        channelId: "channel-123",
        countyCode: "*",
        stateCode: "US-NY",
      });
    });

    it("handles various county codes correctly", async () => {
      repoMock.insertEBirdSubscription.mockResolvedValue(undefined);

      await service.subscribeToEBird("channel-123", "US-CA-037");

      expect(repoMock.insertEBirdSubscription).toHaveBeenCalledWith({
        channelId: "channel-123",
        countyCode: "US-CA-037",
        stateCode: "US-CA",
      });
    });
  });
});
