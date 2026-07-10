import { eq, sql } from "drizzle-orm";
import type { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  channelEBirdSubscriptions,
  deliveries,
} from "@/core/drizzle/drizzle.schema";
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
import { AlertQueueRepository } from "./alert-queue.repository";

describe("AlertQueueRepository", () => {
  let db: DrizzleService;
  let pool: Pool;
  let repository: AlertQueueRepository;

  beforeAll(async () => {
    ({ db, pool } = await createTestDb());
    repository = new AlertQueueRepository(db);
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await truncateAll(db);
  });

  describe("query plan", () => {
    it("anti-joins deliveries instead of scanning per row", async () => {
      await seedLocation(db);
      await seedSubscription(db);
      for (let i = 0; i < 200; i += 1) {
        await seedObservation(db, { subId: `S${i}` });
      }
      const pending = await repository.pendingEBirdAlerts();
      await repository.insertDeliveries(
        pending.map((alert) => ({
          alertId: `${alert.speciesCode}:${alert.subId}`,
          channelId: alert.channelId,
          kind: "ebird" as const,
          status: "sent" as const,
        })),
      );
      await db.db.execute(sql`ANALYZE`);

      // EXPLAIN is a utility statement and cannot take bind parameters,
      // so inline them (highest index first so $1 doesn't clobber $10).
      const { sql: text, params } = repository
        .buildPendingEBirdAlertsQuery()
        .toSQL();
      let inlined = text;
      for (let i = params.length; i >= 1; i -= 1) {
        const param = params[i - 1];
        const literal =
          typeof param === "number" || typeof param === "boolean"
            ? String(param)
            : `'${String(param)}'`;
        inlined = inlined.replaceAll(`$${i}`, literal);
      }

      const result = await pool.query(`EXPLAIN ${inlined}`);
      const plan = result.rows.map((row) => row["QUERY PLAN"]).join("\n");

      // Anchor on the deliveries exclusion specifically: an Anti Join node
      // whose condition references deliveries.alert_id. A generic /Anti
      // Join/ match would also be satisfied by the unrelated
      // filtered_species anti-join, letting the deliveries exclusion
      // regress to a per-row scan undetected.
      expect(plan).toMatch(
        /Anti Join[^\n]*\n\s*\S+ Cond:[^\n]*deliveries\.alert_id/,
      );
    });
  });

  describe("delivery status column", () => {
    it("defaults status to 'sent' and detail to null", async () => {
      await seedDelivery(db);

      const [row] = await db.db.select().from(deliveries);
      expect(row.status).toBe("sent");
      expect(row.detail).toBeNull();
    });

    it("rejects statuses outside the enum at the DB level", async () => {
      // Drizzle wraps the pg error; the constraint name lives on error.cause.
      await expect(
        db.db.execute(
          sql`INSERT INTO deliveries (alert_id, channel_id, alert_kind, status)
              VALUES ('verfly:S001', 'CH1', 'ebird', 'bogus')`,
        ),
      ).rejects.toMatchObject({
        cause: expect.objectContaining({
          message: expect.stringContaining("deliveries_status_check"),
        }),
      });
    });
  });

  describe("backfillDeliveries", () => {
    const scope = {
      channelId: "CH1",
      countyCode: "US-CA-085",
      stateCode: "US-CA",
    };

    it("records every currently-pending alert as delivered without sending", async () => {
      await seedLocation(db);
      await seedSubscription(db);
      await seedObservation(db, { subId: "S001" });
      await seedObservation(db, { subId: "S002" });

      await repository.backfillDeliveries(scope);

      // Nothing is left pending — the historical alerts are marked, not sent.
      expect(await repository.pendingEBirdAlerts()).toHaveLength(0);
      const rows = await db.db.select().from(deliveries);
      expect(rows.map((r) => r.alertId).sort()).toEqual([
        "verfly:S001",
        "verfly:S002",
      ]);
      expect(rows.every((r) => r.kind === "ebird")).toBe(true);
      expect(rows.every((row) => row.status === "suppressed")).toBe(true);
    });

    it("backfills only the given Subscription, leaving others pending", async () => {
      await seedLocation(db);
      await seedSubscription(db); // CH1, county-specific
      await seedSubscription(db, { channelId: "CH2", countyCode: "*" });
      await seedObservation(db, { subId: "S001" });

      await repository.backfillDeliveries(scope); // CH1 only

      const stillPending = await repository.pendingEBirdAlerts();
      expect(stillPending.map((a) => a.channelId)).toEqual(["CH2"]);
    });

    it("skips filtered species and already-delivered alerts", async () => {
      await seedLocation(db);
      await seedSubscription(db);
      await seedFilter(db, { commonName: "Vermilion Flycatcher" });
      await seedObservation(db, { subId: "S001" }); // filtered
      await seedObservation(db, {
        comName: "Snowy Plover",
        speciesCode: "snoplo5",
        subId: "S002",
      });
      await seedDelivery(db, { alertId: "snoplo5:S002" }); // already delivered

      await repository.backfillDeliveries(scope);

      // Filtered species never becomes a delivery; the pre-existing delivery
      // is not duplicated (onConflictDoNothing).
      const rows = await db.db.select().from(deliveries);
      expect(rows.map((r) => r.alertId)).toEqual(["snoplo5:S002"]);
    });
  });

  describe("deactivateChannelSubscriptions", () => {
    it("deactivates only the given channel's active subscriptions", async () => {
      await seedSubscription(db, { channelId: "CH1" });
      await seedSubscription(db, {
        channelId: "CH1",
        countyCode: "*",
        stateCode: "US-WA",
      });
      await seedSubscription(db, { channelId: "CH2" });

      const count = await repository.deactivateChannelSubscriptions("CH1");

      expect(count).toBe(2);
      const rows = await db.db.select().from(channelEBirdSubscriptions);
      for (const row of rows) {
        expect(row.active).toBe(row.channelId === "CH2");
      }
    });
  });

  describe("sweepExpiredAlerts", () => {
    const HOUR = 60 * 60 * 1000;

    it("records expired rows for aged-out undelivered alerts only", async () => {
      const now = Date.now();
      const before = new Date(now - 15 * 60 * 1000);
      const floor = new Date(now - 7 * 24 * HOUR);
      await seedLocation(db);
      await seedSubscription(db);
      // Aged out, undelivered -> expired.
      await seedObservation(db, {
        createdAt: new Date(now - HOUR),
        subId: "S1",
      });
      // Aged out but already delivered -> untouched.
      await seedObservation(db, {
        createdAt: new Date(now - HOUR),
        subId: "S2",
      });
      await seedDelivery(db, { alertId: "verfly:S2" });
      // Still inside the dispatch window -> untouched.
      await seedObservation(db, { createdAt: new Date(now), subId: "S3" });
      // Older than the floor -> untouched.
      await seedObservation(db, {
        createdAt: new Date(now - 8 * 24 * HOUR),
        subId: "S4",
      });

      const expired = await repository.sweepExpiredAlerts(before, floor);

      expect(expired).toEqual([
        {
          alertId: "verfly:S1",
          channelId: "CH1",
          comName: "Vermilion Flycatcher",
        },
      ]);
      const rows = await db.db
        .select()
        .from(deliveries)
        .where(eq(deliveries.status, "expired"));
      expect(rows).toHaveLength(1);
      expect(rows[0].alertId).toBe("verfly:S1");
    });

    it("is idempotent: re-sweeping records nothing new", async () => {
      const now = Date.now();
      const before = new Date(now - 15 * 60 * 1000);
      const floor = new Date(now - 7 * 24 * HOUR);
      await seedLocation(db);
      await seedSubscription(db);
      await seedObservation(db, { createdAt: new Date(now - HOUR) });

      await repository.sweepExpiredAlerts(before, floor);
      const second = await repository.sweepExpiredAlerts(before, floor);

      expect(second).toEqual([]);
      const rows = await db.db.select().from(deliveries);
      expect(rows).toHaveLength(1);
    });

    it("skips filtered species", async () => {
      const now = Date.now();
      await seedLocation(db);
      await seedSubscription(db);
      await seedFilter(db); // filters "Vermilion Flycatcher" on CH1
      await seedObservation(db, { createdAt: new Date(now - HOUR) });

      const expired = await repository.sweepExpiredAlerts(
        new Date(now - 15 * 60 * 1000),
        new Date(now - 7 * 24 * HOUR),
      );

      expect(expired).toEqual([]);
    });
  });
});
