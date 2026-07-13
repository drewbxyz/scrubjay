import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { DrizzleService } from "@/core/drizzle/drizzle.service";
import {
  createTestDb,
  seedDelivery,
  seedLocation,
  seedObservation,
  truncateAll,
} from "@/testing/db-helpers";
import { OpsRepository } from "./ops.repository";

let db: DrizzleService;
let pool: { end: () => Promise<void> };
let repo: OpsRepository;

beforeEach(async () => {
  ({ db, pool } = await createTestDb());
  await truncateAll(db);
  repo = new OpsRepository(db);
});

afterAll(async () => {
  await pool.end();
});

describe("listObservations", () => {
  it("joins locations and filters by state", async () => {
    await seedLocation(db);
    await seedLocation(db, { id: "L002", stateCode: "US-AZ" });
    await seedObservation(db, { locId: "L001", subId: "S1" });
    await seedObservation(db, { locId: "L002", subId: "S2" });
    const result = await repo.listObservations({
      limit: 50,
      offset: 0,
      stateCode: "US-AZ",
    });
    expect(result.observations).toHaveLength(1);
    expect(result.observations[0]?.stateCode).toBe("US-AZ");
    expect(result.hasMore).toBe(false);
  });

  it("paginates with hasMore", async () => {
    await seedLocation(db);
    await seedObservation(db, { subId: "S1" });
    await seedObservation(db, { subId: "S2" });
    const page = await repo.listObservations({ limit: 1, offset: 0 });
    expect(page.observations).toHaveLength(1);
    expect(page.hasMore).toBe(true);
  });

  it("paginates stably when createdAt ties within a batch", async () => {
    await seedLocation(db);
    const createdAt = new Date("2026-07-13T00:00:00.000Z");
    await seedObservation(db, {
      createdAt,
      speciesCode: "verfly",
      subId: "S1",
    });
    await seedObservation(db, {
      createdAt,
      speciesCode: "amerob",
      subId: "S2",
    });
    const first = await repo.listObservations({ limit: 1, offset: 0 });
    const second = await repo.listObservations({ limit: 1, offset: 1 });
    expect(first.observations).toHaveLength(1);
    expect(second.observations).toHaveLength(1);
    expect(first.observations[0]?.subId).not.toBe(
      second.observations[0]?.subId,
    );
  });
});

describe("listDeliveries", () => {
  it("filters by status and channel", async () => {
    await seedDelivery(db, { alertId: "a:1", channelId: "CH1" });
    await seedDelivery(db, {
      alertId: "a:2",
      channelId: "CH2",
      status: "failed",
    });
    const failed = await repo.listDeliveries({
      limit: 50,
      offset: 0,
      status: "failed",
    });
    expect(failed.deliveries).toHaveLength(1);
    expect(failed.deliveries[0]?.channelId).toBe("CH2");
  });
});
