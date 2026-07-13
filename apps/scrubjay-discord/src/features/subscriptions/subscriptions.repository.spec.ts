import type { Pool } from "pg";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { DrizzleService } from "@/core/drizzle/drizzle.service";
import {
  createTestDb,
  seedSubscription,
  truncateAll,
} from "@/testing/db-helpers";
import type { AlertQueue } from "../dispatch/alert-queue.service";
import { SubscriptionsRepository } from "./subscriptions.repository";

describe("SubscriptionsRepository", () => {
  let db: DrizzleService;
  let pool: Pool;
  let repo: SubscriptionsRepository;

  const backfillEBird = vi.fn();
  const alertQueueMock = { backfillEBird } as unknown as AlertQueue;

  const subscription = {
    channelId: "channel-123",
    countyCode: "US-WA-033",
    stateCode: "US-WA",
  };

  beforeAll(async () => {
    ({ db, pool } = await createTestDb());
    repo = new SubscriptionsRepository(db, alertQueueMock);
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    await truncateAll(db);
  });

  describe("insertSubscription", () => {
    it("inserts the row, backfills, and reports true when newly subscribed", async () => {
      const result = await repo.insertSubscription(subscription);

      expect(result).toBe(true);
      expect(backfillEBird).toHaveBeenCalledWith(
        subscription,
        expect.anything(),
      );

      const rows = await repo.subscriptionsForChannel(subscription.channelId);
      expect(rows).toHaveLength(1);
    });

    it("skips the backfill and reports false when already subscribed", async () => {
      await repo.insertSubscription(subscription);
      backfillEBird.mockClear();

      const result = await repo.insertSubscription(subscription);

      expect(result).toBe(false);
      expect(backfillEBird).not.toHaveBeenCalled();
    });
  });

  describe("deleteSubscription", () => {
    it("reports true when a row was removed", async () => {
      await seedSubscription(db, subscription);

      expect(await repo.deleteSubscription(subscription)).toBe(true);
    });

    it("reports false when nothing matched", async () => {
      expect(await repo.deleteSubscription(subscription)).toBe(false);
    });
  });

  describe("subscriptionsForChannel", () => {
    it("returns the channel's rows in state/county order", async () => {
      await seedSubscription(db, subscription);

      const result = await repo.subscriptionsForChannel(subscription.channelId);

      expect(result).toHaveLength(1);
      expect(result[0]?.channelId).toBe(subscription.channelId);
    });
  });

  describe("listSubscriptions", () => {
    it("returns all subscriptions when no filter is given", async () => {
      await seedSubscription(db, { channelId: "CH1" });
      await seedSubscription(db, { channelId: "CH2", stateCode: "US-AZ" });
      const all = await repo.listSubscriptions();
      expect(all).toHaveLength(2);
    });

    it("filters by channelId and stateCode", async () => {
      await seedSubscription(db, { channelId: "CH1", stateCode: "US-CA" });
      await seedSubscription(db, { channelId: "CH2", stateCode: "US-AZ" });
      expect(await repo.listSubscriptions({ channelId: "CH1" })).toHaveLength(
        1,
      );
      expect(await repo.listSubscriptions({ stateCode: "US-AZ" })).toHaveLength(
        1,
      );
    });
  });

  describe("setSubscriptionActive", () => {
    it("toggles active and reports whether the row existed", async () => {
      const sub = await seedSubscription(db, { active: true });
      const key = {
        channelId: sub.channelId,
        countyCode: sub.countyCode,
        stateCode: sub.stateCode,
      };
      expect(await repo.setSubscriptionActive(key, false)).toBe(true);
      const [row] = await repo.listSubscriptions({
        channelId: sub.channelId,
      });
      expect(row?.active).toBe(false);
      expect(
        await repo.setSubscriptionActive({ ...key, channelId: "NOPE" }, true),
      ).toBe(false);
    });
  });
});
