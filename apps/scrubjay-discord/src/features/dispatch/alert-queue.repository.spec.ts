import { eq, sql } from "drizzle-orm";
import type { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  channelEBirdSubscriptions,
  deliveries,
  observations,
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
import {
  AlertQueueRepository,
  PENDING_ALERT_LIMIT,
} from "./alert-queue.repository";

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

    it("has a covering index for the recentlyConfirmed probe", async () => {
      const result = await pool.query(
        `SELECT indexdef FROM pg_indexes
         WHERE tablename = 'observations'
           AND indexname = 'obs_species_location_date_idx'`,
      );
      expect(result.rowCount).toBe(1);
      // pg_indexes reconstructs the DDL and only quotes identifiers that
      // need it; plain lowercase snake_case columns come back unquoted.
      expect(result.rows[0].indexdef).toContain(
        "(species_code, location_id, observation_date)",
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

    it("suppresses only alerts within the backfill window, leaving older ones untouched", async () => {
      // Dispatch sends on a fixed 15-minute lookback, so alerts older than the
      // 8-day backfill window can never reach the new channel — and before the
      // retention prune runs, the table may hold months of stale observations
      // that a full-table backfill would needlessly mark.
      await seedLocation(db);
      await seedSubscription(db);
      const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
      await seedObservation(db, { subId: "S_RECENT" });
      await seedObservation(db, { createdAt: tenDaysAgo, subId: "S_OLD" });

      await repository.backfillDeliveries(scope);

      // Only the in-window alert is suppressed; the stale one is left alone.
      const rows = await db.db.select().from(deliveries);
      expect(rows.map((r) => r.alertId)).toEqual(["verfly:S_RECENT"]);
    });

    it("backfills a region whose pending count exceeds the bind-param limit", async () => {
      // A statewide subscription's 14-day backfill can pull tens of thousands
      // of pending rows. Each delivery row binds 4 params; a single unbatched
      // insert past 65535/4 = 16383 rows overflows Postgres's 16-bit param
      // count and desyncs the wire protocol ("bind message has N parameter
      // formats but 0 parameters"). Seed just over the boundary.
      const rowCount = 16_384;
      await seedLocation(db);
      await seedSubscription(db);
      const obsRows = Array.from({ length: rowCount }, (_, i) => ({
        audioCount: 0,
        comName: "Vermilion Flycatcher",
        createdAt: new Date(),
        hasComments: false,
        howMany: 1,
        locId: "L001",
        obsDt: new Date(),
        obsReviewed: false,
        obsValid: false,
        photoCount: 0,
        presenceNoted: false,
        sciName: "Pyrocephalus rubinus",
        speciesCode: "verfly",
        subId: `S${String(i).padStart(6, "0")}`,
        videoCount: 0,
      }));
      for (let i = 0; i < obsRows.length; i += 1000) {
        await db.db.insert(observations).values(obsRows.slice(i, i + 1000));
      }

      await repository.backfillDeliveries(scope);

      const [{ count }] = await db.db
        .select({ count: sql<number>`count(*)::int` })
        .from(deliveries);
      expect(count).toBe(rowCount);
      expect(await repository.pendingEBirdAlerts()).toHaveLength(0);
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

  describe("pending read bound", () => {
    it("returns at most PENDING_ALERT_LIMIT alerts, oldest first", async () => {
      await seedLocation(db);
      await seedSubscription(db);
      const base = Date.now();
      const rows = Array.from({ length: PENDING_ALERT_LIMIT + 10 }, (_, i) => ({
        audioCount: 0,
        comName: "Vermilion Flycatcher",
        // i = 0 is oldest; the 10 newest rows must be the ones deferred.
        createdAt: new Date(base - (PENDING_ALERT_LIMIT + 10 - i) * 1000),
        hasComments: false,
        howMany: 1,
        locId: "L001",
        obsDt: new Date(),
        obsReviewed: false,
        obsValid: false,
        photoCount: 0,
        presenceNoted: false,
        sciName: "Pyrocephalus rubinus",
        speciesCode: "verfly",
        subId: `S${String(i).padStart(4, "0")}`,
        videoCount: 0,
      }));
      for (let i = 0; i < rows.length; i += 1000) {
        await db.db.insert(observations).values(rows.slice(i, i + 1000));
      }

      const pending = await repository.pendingEBirdAlerts();

      expect(pending).toHaveLength(PENDING_ALERT_LIMIT);
      expect(pending[0].subId).toBe("S0000");
      const returned = new Set(pending.map((alert) => alert.subId));
      for (let i = PENDING_ALERT_LIMIT; i < PENDING_ALERT_LIMIT + 10; i += 1) {
        expect(returned.has(`S${String(i).padStart(4, "0")}`)).toBe(false);
      }
    });

    it("breaks a genuine channel_id tie at the truncation boundary deterministically", async () => {
      // Two locations in the same state, different counties: L001 (the
      // county-specific subscription's home) and L002 (matched only by the
      // wildcard subscription). CH1 is scoped to L001's county only; CH2's
      // "*" county matches both. Filler observations all live at L002, so
      // only CH2 fans out to them (one pending row each) — CH1 never sees
      // them. The single newest observation lives at L001, so it fans out
      // to BOTH channels: two pending rows sharing createdAt, speciesCode,
      // and subId, differing only by channelId. That is the genuine tie the
      // orderBy's channel_id key must break.
      await seedLocation(db);
      await seedLocation(db, {
        county: "Other County",
        countyCode: "US-CA-999",
        id: "L002",
      });
      await seedSubscription(db, { channelId: "CH1", countyCode: "US-CA-085" });
      await seedSubscription(db, { channelId: "CH2", countyCode: "*" });

      const base = Date.now();
      const fillerCount = PENDING_ALERT_LIMIT - 1;
      const fillerRows = Array.from({ length: fillerCount }, (_, i) => ({
        audioCount: 0,
        comName: "Vermilion Flycatcher",
        createdAt: new Date(base - (fillerCount - i) * 1000),
        hasComments: false,
        howMany: 1,
        locId: "L002",
        obsDt: new Date(),
        obsReviewed: false,
        obsValid: false,
        photoCount: 0,
        presenceNoted: false,
        sciName: "Pyrocephalus rubinus",
        speciesCode: "verfly",
        subId: `S${String(i).padStart(4, "0")}`,
        videoCount: 0,
      }));
      for (let i = 0; i < fillerRows.length; i += 1000) {
        await db.db.insert(observations).values(fillerRows.slice(i, i + 1000));
      }
      // Newest observation — created after every filler row — fans out to
      // both CH1 and CH2, producing the tie at the tail of the sort order.
      await seedObservation(db, {
        createdAt: new Date(base),
        locId: "L001",
        subId: "SNEW",
      });

      const pending = await repository.pendingEBirdAlerts();

      expect(pending).toHaveLength(PENDING_ALERT_LIMIT);
      const newestRows = pending.filter((alert) => alert.subId === "SNEW");
      expect(newestRows.map((alert) => alert.channelId)).toEqual(["CH1"]);
    });
  });
});
