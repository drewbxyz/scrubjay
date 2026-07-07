import { sql } from "drizzle-orm";
import type { Pool } from "pg";
import type { DrizzleService } from "@/core/drizzle/drizzle.service";
import {
  createTestDb,
  seedLocation,
  seedObservation,
  seedSubscription,
  truncateAll,
} from "@/testing/db-helpers";
import { AlertQueueRepository } from "../alert-queue.repository";

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
});
