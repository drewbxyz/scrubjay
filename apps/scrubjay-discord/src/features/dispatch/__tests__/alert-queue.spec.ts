import type { Pool } from "pg";
import { deliveries } from "@/core/drizzle/drizzle.schema";
import type { DrizzleService } from "@/core/drizzle/drizzle.service";
import {
  createTestDb,
  seedDelivery,
  seedFilter,
  seedLocation,
  seedObservation,
  seedSubscription,
  truncateAll,
} from "@/testing/db-helpers";
import { AlertQueue } from "../alert-queue";
import { AlertQueueRepository } from "../alert-queue.repository";

describe("AlertQueue", () => {
  let db: DrizzleService;
  let pool: Pool;
  let queue: AlertQueue;

  beforeAll(() => {
    ({ db, pool } = createTestDb());
    queue = new AlertQueue(new AlertQueueRepository(db));
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await truncateAll(db);
  });

  describe("pendingEBirdAlerts", () => {
    it("returns an alert when an observation matches an active county subscription", async () => {
      await seedLocation(db);
      await seedObservation(db);
      await seedSubscription(db);

      const pending = await queue.pendingEBirdAlerts();

      expect(pending).toHaveLength(1);
      expect(pending[0]).toMatchObject({
        channelId: "CH1",
        comName: "Vermilion Flycatcher",
        county: "Santa Clara",
        speciesCode: "verfly",
        subId: "S001",
      });
    });

    it("does not match a subscription for a different county", async () => {
      await seedLocation(db);
      await seedObservation(db);
      await seedSubscription(db, { countyCode: "US-CA-001" });

      expect(await queue.pendingEBirdAlerts()).toHaveLength(0);
    });

    it("matches any county in the state for a wildcard subscription", async () => {
      await seedLocation(db, { county: "Elsewhere", countyCode: "US-CA-999" });
      await seedObservation(db);
      await seedSubscription(db, { countyCode: "*" });

      expect(await queue.pendingEBirdAlerts()).toHaveLength(1);
    });

    it("does not match a wildcard subscription in a different state", async () => {
      await seedLocation(db, { state: "Oregon", stateCode: "US-OR" });
      await seedObservation(db);
      await seedSubscription(db, { countyCode: "*" }); // US-CA

      expect(await queue.pendingEBirdAlerts()).toHaveLength(0);
    });

    it("ignores inactive subscriptions", async () => {
      await seedLocation(db);
      await seedObservation(db);
      await seedSubscription(db, { active: false });

      expect(await queue.pendingEBirdAlerts()).toHaveLength(0);
    });

    it("excludes species filtered on that channel but not on others", async () => {
      await seedLocation(db);
      await seedObservation(db);
      await seedSubscription(db, { channelId: "CH1" });
      await seedSubscription(db, { channelId: "CH2" });
      await seedFilter(db, { channelId: "CH1" });

      const pending = await queue.pendingEBirdAlerts();

      expect(pending.map((alert) => alert.channelId)).toEqual(["CH2"]);
    });

    it("excludes alerts already delivered to that channel but not to others", async () => {
      await seedLocation(db);
      await seedObservation(db);
      await seedSubscription(db, { channelId: "CH1" });
      await seedSubscription(db, { channelId: "CH2" });
      await seedDelivery(db, { channelId: "CH1" });

      const pending = await queue.pendingEBirdAlerts();

      expect(pending.map((alert) => alert.channelId)).toEqual(["CH2"]);
    });

    it("applies the since cutoff to ingest time, not observation time", async () => {
      await seedLocation(db);
      // Old sighting ingested just now: still alerts.
      await seedObservation(db, {
        createdAt: new Date(),
        obsDt: new Date("2026-01-01"),
        subId: "S001",
      });
      // Recent sighting ingested an hour ago: outside the window.
      await seedObservation(db, {
        createdAt: new Date(Date.now() - 60 * 60 * 1000),
        obsDt: new Date(),
        subId: "S002",
      });
      await seedSubscription(db);

      const pending = await queue.pendingEBirdAlerts(
        new Date(Date.now() - 15 * 60 * 1000),
      );

      expect(pending.map((alert) => alert.subId)).toEqual(["S001"]);
    });
  });

  describe("recentlyConfirmed", () => {
    it("is true when a valid+reviewed observation of the same species and location is within 7 days", async () => {
      await seedLocation(db);
      await seedSubscription(db);
      await seedObservation(db, { subId: "S001" });
      await seedObservation(db, {
        obsDt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
        obsReviewed: true,
        obsValid: true,
        subId: "S002",
      });

      const pending = await queue.pendingEBirdAlerts();
      const alert = pending.find((a) => a.subId === "S001");

      expect(alert?.recentlyConfirmed).toBe(true);
    });

    it("is false when the confirming observation is older than 7 days", async () => {
      await seedLocation(db);
      await seedSubscription(db);
      await seedObservation(db, { subId: "S001" });
      await seedObservation(db, {
        obsDt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
        obsReviewed: true,
        obsValid: true,
        subId: "S002",
      });

      const pending = await queue.pendingEBirdAlerts();
      const alert = pending.find((a) => a.subId === "S001");

      expect(alert?.recentlyConfirmed).toBe(false);
    });

    it("is false when the observation is valid but not reviewed", async () => {
      await seedLocation(db);
      await seedSubscription(db);
      await seedObservation(db, { subId: "S001" });
      await seedObservation(db, {
        obsDt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
        obsReviewed: false,
        obsValid: true,
        subId: "S002",
      });

      const pending = await queue.pendingEBirdAlerts();
      const alert = pending.find((a) => a.subId === "S001");

      expect(alert?.recentlyConfirmed).toBe(false);
    });
  });

  describe("markSent", () => {
    it("records a delivery with alertId speciesCode:subId and kind ebird", async () => {
      await queue.markSent([
        { channelId: "CH1", speciesCode: "verfly", subId: "S001" },
      ]);

      const rows = await db.db.select().from(deliveries);

      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        alertId: "verfly:S001",
        channelId: "CH1",
        kind: "ebird",
      });
    });

    it("is idempotent", async () => {
      const alerts = [
        { channelId: "CH1", speciesCode: "verfly", subId: "S001" },
      ];

      await queue.markSent(alerts);
      await queue.markSent(alerts);

      expect(await db.db.select().from(deliveries)).toHaveLength(1);
    });

    it("handles more alerts than one batch", async () => {
      const alerts = Array.from({ length: 250 }, (_, i) => ({
        channelId: "CH1",
        speciesCode: "verfly",
        subId: `S${i}`,
      }));

      await queue.markSent(alerts);

      expect(await db.db.select().from(deliveries)).toHaveLength(250);
    });

    it("marked alerts stop being pending", async () => {
      await seedLocation(db);
      await seedObservation(db);
      await seedSubscription(db);

      await queue.markSent(await queue.pendingEBirdAlerts());

      expect(await queue.pendingEBirdAlerts()).toHaveLength(0);
    });
  });
});
