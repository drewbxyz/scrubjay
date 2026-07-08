import { Logger } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import { SubscriptionsRepository } from "../subscriptions.repository";
import { SubscriptionsService } from "../subscriptions.service";

describe("SubscriptionsService", () => {
  let service: SubscriptionsService;
  let loggerErrorSpy: jest.SpyInstance;

  const repoMock = {
    insertEBirdSubscription: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        {
          provide: SubscriptionsService,
          useFactory: () =>
            new SubscriptionsService(
              repoMock as unknown as SubscriptionsRepository,
            ),
        },
      ],
    }).compile();

    service = module.get<SubscriptionsService>(SubscriptionsService);
    loggerErrorSpy = jest.spyOn(Logger.prototype, "error").mockImplementation();
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.resetAllMocks();
    loggerErrorSpy.mockRestore();
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
      expect(loggerErrorSpy).not.toHaveBeenCalled();
    });

    it("successfully subscribes to a county-level region (3 parts)", async () => {
      repoMock.insertEBirdSubscription.mockResolvedValue(undefined);

      await service.subscribeToEBird("channel-123", "US-WA-033");

      expect(repoMock.insertEBirdSubscription).toHaveBeenCalledWith({
        channelId: "channel-123",
        countyCode: "US-WA-033",
        stateCode: "US-WA",
      });
      expect(loggerErrorSpy).not.toHaveBeenCalled();
    });

    it("rejects invalid region code with 1 part", async () => {
      await expect(
        service.subscribeToEBird("channel-123", "US"),
      ).rejects.toThrow("Invalid region code: US");

      expect(repoMock.insertEBirdSubscription).not.toHaveBeenCalled();
      expect(loggerErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("Invalid region code: US"),
      );
    });

    it("rejects invalid region code with 4+ parts", async () => {
      await expect(
        service.subscribeToEBird("channel-123", "US-WA-033-EXTRA"),
      ).rejects.toThrow("Invalid region code: US-WA-033-EXTRA");

      expect(repoMock.insertEBirdSubscription).not.toHaveBeenCalled();
      expect(loggerErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("Invalid region code: US-WA-033-EXTRA"),
      );
    });

    it("rejects empty region code", async () => {
      await expect(service.subscribeToEBird("channel-123", "")).rejects.toThrow(
        "Invalid region code",
      );

      expect(repoMock.insertEBirdSubscription).not.toHaveBeenCalled();
      expect(loggerErrorSpy).toHaveBeenCalled();
    });

    it("rejects when the database insert fails", async () => {
      const dbError = new Error("Database connection failed");
      repoMock.insertEBirdSubscription.mockRejectedValue(dbError);

      await expect(
        service.subscribeToEBird("channel-123", "US-WA"),
      ).rejects.toThrow("Failed to subscribe to eBird");

      expect(repoMock.insertEBirdSubscription).toHaveBeenCalledWith({
        channelId: "channel-123",
        countyCode: "*",
        stateCode: "US-WA",
      });
      expect(loggerErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("Failed to subscribe to eBird"),
      );
    });

    it("handles various state codes correctly", async () => {
      repoMock.insertEBirdSubscription.mockResolvedValue(undefined);

      await service.subscribeToEBird("channel-123", "US-CA");
      await service.subscribeToEBird("channel-123", "US-NY");
      await service.subscribeToEBird("channel-123", "US-TX");

      expect(repoMock.insertEBirdSubscription).toHaveBeenCalledTimes(3);
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
      expect(repoMock.insertEBirdSubscription).toHaveBeenNthCalledWith(3, {
        channelId: "channel-123",
        countyCode: "*",
        stateCode: "US-TX",
      });
    });

    it("handles various county codes correctly", async () => {
      repoMock.insertEBirdSubscription.mockResolvedValue(undefined);

      await service.subscribeToEBird("channel-123", "US-WA-033");
      await service.subscribeToEBird("channel-123", "US-CA-037");
      await service.subscribeToEBird("channel-123", "US-NY-061");

      expect(repoMock.insertEBirdSubscription).toHaveBeenCalledTimes(3);
      expect(repoMock.insertEBirdSubscription).toHaveBeenNthCalledWith(1, {
        channelId: "channel-123",
        countyCode: "US-WA-033",
        stateCode: "US-WA",
      });
      expect(repoMock.insertEBirdSubscription).toHaveBeenNthCalledWith(2, {
        channelId: "channel-123",
        countyCode: "US-CA-037",
        stateCode: "US-CA",
      });
      expect(repoMock.insertEBirdSubscription).toHaveBeenNthCalledWith(3, {
        channelId: "channel-123",
        countyCode: "US-NY-061",
        stateCode: "US-NY",
      });
    });
  });
});
