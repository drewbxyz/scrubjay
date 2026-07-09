import { sql } from "drizzle-orm";
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
import { AlertQueueRepository } from "./alert-queue.repository";

describe("AlertQueueRepository", () => {
  let db: DrizzleService;
  let pool: Pool;
  let repository: AlertQueueRepository;

  beforeAll(() => {
    ({ db, pool } = createTestDb());
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
});
