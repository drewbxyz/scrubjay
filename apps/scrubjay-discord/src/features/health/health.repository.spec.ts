import type { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DrizzleService } from "@/core/drizzle/drizzle.service";
import { createTestDb, seedDelivery, truncateAll } from "@/testing/db-helpers";
import { HealthRepository } from "./health.repository";

describe("HealthRepository", () => {
  let db: DrizzleService;
  let pool: Pool;
  let repository: HealthRepository;

  beforeAll(async () => {
    ({ db, pool } = await createTestDb());
    repository = new HealthRepository(db);
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await truncateAll(db);
  });

  it("zero-fills every status when there are no deliveries", async () => {
    await expect(repository.recentDeliveryCounts()).resolves.toEqual({
      expired: 0,
      failed: 0,
      sent: 0,
      suppressed: 0,
    });
  });

  it("counts recent deliveries grouped by status", async () => {
    await seedDelivery(db, { alertId: "a:1", status: "sent" });
    await seedDelivery(db, { alertId: "a:2", status: "sent" });
    await seedDelivery(db, { alertId: "a:3", status: "failed" });
    await seedDelivery(db, { alertId: "a:4", status: "expired" });

    await expect(repository.recentDeliveryCounts()).resolves.toEqual({
      expired: 1,
      failed: 1,
      sent: 2,
      suppressed: 0,
    });
  });

  it("excludes deliveries older than 24 hours", async () => {
    await seedDelivery(db, {
      alertId: "old:1",
      sentAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
      status: "sent",
    });
    await seedDelivery(db, { alertId: "new:1", status: "sent" });

    const counts = await repository.recentDeliveryCounts();
    expect(counts.sent).toBe(1);
  });
});
