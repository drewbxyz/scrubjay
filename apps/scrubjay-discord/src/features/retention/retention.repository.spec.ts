import type { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  deliveries,
  locations,
  observations,
} from "@/core/drizzle/drizzle.schema";
import type { DrizzleService } from "@/core/drizzle/drizzle.service";
import {
  createTestDb,
  seedDelivery,
  seedLocation,
  seedObservation,
  truncateAll,
} from "@/testing/db-helpers";
import { RetentionRepository } from "./retention.repository";

const DAY_MS = 24 * 60 * 60 * 1000;
const daysAgo = (days: number) => new Date(Date.now() - days * DAY_MS);

describe("RetentionRepository", () => {
  let db: DrizzleService;
  let pool: Pool;
  let repository: RetentionRepository;

  beforeAll(async () => {
    ({ db, pool } = await createTestDb());
    repository = new RetentionRepository(db);
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await truncateAll(db);
  });

  describe("pruneObservations", () => {
    it("deletes rows past the cutoff and keeps younger ones", async () => {
      await seedLocation(db);
      await seedObservation(db, { createdAt: daysAgo(20), subId: "OLD" });
      await seedObservation(db, { createdAt: daysAgo(5), subId: "YOUNG" });

      const deleted = await repository.pruneObservations(daysAgo(14));

      expect(deleted).toBe(1);
      const remaining = await db.db.select().from(observations);
      expect(remaining.map((row) => row.subId)).toEqual(["YOUNG"]);
    });

    it("never deletes a recently created row, whatever its obsDt (resurrection invariant)", async () => {
      await seedLocation(db);
      await seedObservation(db, {
        createdAt: new Date(),
        obsDt: daysAgo(30),
        subId: "LATE_INGEST",
      });

      const deleted = await repository.pruneObservations(daysAgo(14));

      expect(deleted).toBe(0);
    });

    it("drains rows spanning several batches", async () => {
      await seedLocation(db);
      for (let i = 0; i < 5; i += 1) {
        await seedObservation(db, { createdAt: daysAgo(20), subId: `S${i}` });
      }

      const deleted = await repository.pruneObservations(daysAgo(14), 2);

      expect(deleted).toBe(5);
      const remaining = await db.db.select().from(observations);
      expect(remaining).toHaveLength(0);
    });
  });

  describe("pruneDeliveries", () => {
    it("deletes rows past the cutoff by sentAt and keeps younger ones", async () => {
      await seedDelivery(db, { alertId: "verfly:OLD", sentAt: daysAgo(40) });
      await seedDelivery(db, { alertId: "verfly:YOUNG", sentAt: daysAgo(10) });

      const deleted = await repository.pruneDeliveries(daysAgo(30));

      expect(deleted).toBe(1);
      const remaining = await db.db.select().from(deliveries);
      expect(remaining.map((row) => row.alertId)).toEqual(["verfly:YOUNG"]);
    });

    it("prunes rows with a NULL sent_at (never immortal)", async () => {
      await seedDelivery(db, { alertId: "verfly:NULLSENT", sentAt: null });

      const deleted = await repository.pruneDeliveries(daysAgo(30));

      expect(deleted).toBe(1);
      const remaining = await db.db.select().from(deliveries);
      expect(remaining).toHaveLength(0);
    });
  });

  describe("pruneOrphanLocations", () => {
    it("deletes only locations no observation references", async () => {
      await seedLocation(db, { id: "L_ORPHAN" });
      await seedLocation(db, { id: "L_LIVE" });
      await seedObservation(db, { locId: "L_LIVE" });

      const deleted = await repository.pruneOrphanLocations();

      expect(deleted).toBe(1);
      const remaining = await db.db.select().from(locations);
      expect(remaining.map((row) => row.id)).toEqual(["L_LIVE"]);
    });
  });
});
