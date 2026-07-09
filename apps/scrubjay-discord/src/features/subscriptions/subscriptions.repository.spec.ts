import { DrizzleService } from "@/core/drizzle/drizzle.service";
import type { AlertQueue } from "../dispatch/alert-queue.service";
import { SubscriptionsRepository } from "./subscriptions.repository";

describe("SubscriptionsRepository", () => {
  let repository: SubscriptionsRepository;

  const backfillEBird = jest.fn();

  // insert chain: tx.insert().values().onConflictDoNothing().returning()
  const insertReturning = jest.fn();
  const insertOnConflict = jest.fn(() => ({ returning: insertReturning }));
  const insertValues = jest.fn(() => ({ onConflictDoNothing: insertOnConflict }));
  const tx = { insert: jest.fn(() => ({ values: insertValues })) };

  // delete chain: db.delete().where().returning()
  const deleteReturning = jest.fn();
  const deleteWhere = jest.fn(() => ({ returning: deleteReturning }));

  // select chain: db.select().from().where().orderBy()
  const selectOrderBy = jest.fn();
  const selectWhere = jest.fn(() => ({ orderBy: selectOrderBy }));
  const selectFrom = jest.fn(() => ({ where: selectWhere }));

  const drizzleMock = {
    db: {
      transaction: jest.fn(async (cb) => cb(tx)),
      delete: jest.fn(() => ({ where: deleteWhere })),
      select: jest.fn(() => ({ from: selectFrom })),
    },
  } as unknown as DrizzleService;

  const alertQueueMock = { backfillEBird } as unknown as AlertQueue;

  const subscription = {
    channelId: "channel-123",
    countyCode: "US-WA-033",
    stateCode: "US-WA",
  };

  beforeEach(() => {
    jest.clearAllMocks();
    repository = new SubscriptionsRepository(drizzleMock, alertQueueMock);
  });

  describe("insertSubscription", () => {
    it("inserts the row, backfills, and reports true when newly subscribed", async () => {
      insertReturning.mockResolvedValue([{ channelId: "channel-123" }]);

      const result = await repository.insertSubscription(subscription);

      expect(result).toBe(true);
      expect(insertValues).toHaveBeenCalledWith(subscription);
      expect(backfillEBird).toHaveBeenCalledWith(subscription, tx);
    });

    it("skips the backfill and reports false when already subscribed", async () => {
      insertReturning.mockResolvedValue([]);

      const result = await repository.insertSubscription(subscription);

      expect(result).toBe(false);
      expect(backfillEBird).not.toHaveBeenCalled();
    });
  });

  describe("deleteSubscription", () => {
    it("reports true when a row was removed", async () => {
      deleteReturning.mockResolvedValue([{ channelId: "channel-123" }]);

      expect(await repository.deleteSubscription(subscription)).toBe(true);
    });

    it("reports false when nothing matched", async () => {
      deleteReturning.mockResolvedValue([]);

      expect(await repository.deleteSubscription(subscription)).toBe(false);
    });
  });

  describe("subscriptionsForChannel", () => {
    it("returns the channel's rows in state/county order", async () => {
      const rows = [subscription];
      selectOrderBy.mockResolvedValue(rows);

      const result = await repository.subscriptionsForChannel("channel-123");

      expect(result).toBe(rows);
      expect(selectFrom).toHaveBeenCalled();
      expect(selectOrderBy).toHaveBeenCalled();
    });
  });
});
