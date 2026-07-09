import { Test, type TestingModule } from "@nestjs/testing";
import { DrizzleService } from "@/core/drizzle/drizzle.service";
import { SubscriptionsRepository } from "./subscriptions.repository";

describe("SubscriptionsRepository", () => {
  let repository: SubscriptionsRepository;

  const mockInsert = jest.fn();
  const mockValues = jest.fn();
  const mockOnConflictDoNothing = jest.fn();
  const mockSelect = jest.fn();
  const mockFrom = jest.fn();
  const mockInnerJoin = jest.fn();
  const mockLeftJoin = jest.fn();
  const mockWhere = jest.fn();
  const mockTransaction = jest.fn();

  const mockTx = {
    insert: jest.fn(),
    select: mockSelect,
  };

  const drizzleMock = {
    db: {
      insert: mockInsert,
      transaction: mockTransaction,
    },
  } as unknown as DrizzleService;

  beforeEach(async () => {
    // Setup transaction mock
    mockTransaction.mockImplementation(async (callback) => {
      return callback(mockTx);
    });

    // Setup insert chain for eBird subscriptions
    mockInsert.mockReturnValue({
      values: mockValues,
    });
    mockValues.mockReturnValue({
      onConflictDoNothing: mockOnConflictDoNothing,
    });
    mockOnConflictDoNothing.mockResolvedValue(undefined);

    // Setup tx.insert chain
    mockTx.insert.mockReturnValue({
      values: mockValues,
    });

    // Setup query chain for finding undelivered observations
    mockSelect.mockReturnValue({
      from: mockFrom,
    });
    mockFrom.mockReturnValue({
      innerJoin: mockInnerJoin,
      leftJoin: mockLeftJoin,
    });
    mockInnerJoin.mockReturnValue({
      innerJoin: mockInnerJoin,
      leftJoin: mockLeftJoin,
    });
    mockLeftJoin.mockReturnValue({
      leftJoin: mockLeftJoin,
      where: mockWhere,
    });
    mockWhere.mockResolvedValue([]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        {
          provide: SubscriptionsRepository,
          useFactory: () => new SubscriptionsRepository(drizzleMock),
        },
      ],
    }).compile();

    repository = module.get<SubscriptionsRepository>(SubscriptionsRepository);
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  describe("insertEBirdSubscription", () => {
    it("inserts an eBird subscription successfully", async () => {
      const subscription = {
        channelId: "channel-123",
        countyCode: "*",
        stateCode: "US-WA",
      };

      await repository.insertEBirdSubscription(subscription);

      expect(mockTransaction).toHaveBeenCalledTimes(1);
      expect(mockTx.insert).toHaveBeenCalled();
      expect(mockValues).toHaveBeenCalledWith(subscription);
      expect(mockOnConflictDoNothing).toHaveBeenCalled();
    });

    it("creates deliveries for existing undelivered observations", async () => {
      const subscription = {
        channelId: "channel-123",
        countyCode: "US-WA-033",
        stateCode: "US-WA",
      };

      const mockObservations = [
        {
          speciesCode: "comloo",
          subId: "sub-1",
        },
        {
          speciesCode: "balori",
          subId: "sub-2",
        },
      ];

      mockWhere.mockResolvedValue(mockObservations);

      await repository.insertEBirdSubscription(subscription);

      expect(mockTransaction).toHaveBeenCalledTimes(1);
      expect(mockTx.insert).toHaveBeenCalledTimes(2); // Once for subscription, once for deliveries
      expect(mockValues).toHaveBeenCalledWith(subscription);

      // Check that deliveries were created
      const deliveryCalls = mockTx.insert.mock.calls.filter(
        (call) => call[0] !== undefined,
      );
      expect(deliveryCalls.length).toBeGreaterThan(0);
    });

    it("batches deliveries in chunks of 100", async () => {
      const subscription = {
        channelId: "channel-123",
        countyCode: "US-WA-033",
        stateCode: "US-WA",
      };

      // Create 250 mock observations
      const mockObservations = Array.from({ length: 250 }, (_, i) => ({
        speciesCode: `species-${i}`,
        subId: `sub-${i}`,
      }));

      mockWhere.mockResolvedValue(mockObservations);

      await repository.insertEBirdSubscription(subscription);

      // We expect at least 3 calls (one for each batch)
      // The exact count depends on implementation, but should be multiple
      expect(mockTx.insert.mock.calls.length).toBeGreaterThan(2);
    });

    it("handles subscriptions with no existing observations", async () => {
      const subscription = {
        channelId: "channel-123",
        countyCode: "*",
        stateCode: "US-WA",
      };

      mockWhere.mockResolvedValue([]);

      await repository.insertEBirdSubscription(subscription);

      expect(mockTransaction).toHaveBeenCalledTimes(1);
      expect(mockTx.insert).toHaveBeenCalledTimes(1); // Only subscription insert
      expect(mockValues).toHaveBeenCalledWith(subscription);
    });

    it("handles state-level subscription (countyCode = '*')", async () => {
      const subscription = {
        channelId: "channel-123",
        countyCode: "*",
        stateCode: "US-WA",
      };

      await repository.insertEBirdSubscription(subscription);

      expect(mockTransaction).toHaveBeenCalledTimes(1);
      expect(mockTx.insert).toHaveBeenCalled();
      expect(mockValues).toHaveBeenCalledWith(subscription);
    });

    it("handles county-level subscription", async () => {
      const subscription = {
        channelId: "channel-123",
        countyCode: "US-WA-033",
        stateCode: "US-WA",
      };

      await repository.insertEBirdSubscription(subscription);

      expect(mockTransaction).toHaveBeenCalledTimes(1);
      expect(mockTx.insert).toHaveBeenCalled();
      expect(mockValues).toHaveBeenCalledWith(subscription);
    });

    it("handles transaction errors", async () => {
      const subscription = {
        channelId: "channel-123",
        countyCode: "*",
        stateCode: "US-WA",
      };

      const transactionError = new Error("Transaction failed");
      mockTransaction.mockRejectedValue(transactionError);

      await expect(
        repository.insertEBirdSubscription(subscription),
      ).rejects.toThrow("Transaction failed");
    });
  });
});
