import type { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DrizzleService } from "@/core/drizzle/drizzle.service";
import {
  createTestDb,
  seedSubscription,
  truncateAll,
} from "@/testing/db-helpers";
import { FiltersRepository } from "./filters.repository";

describe("FiltersRepository", () => {
  let db: DrizzleService;
  let pool: Pool;
  let repository: FiltersRepository;

  beforeAll(async () => {
    ({ db, pool } = await createTestDb());
    repository = new FiltersRepository(db);
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await truncateAll(db);
  });

  describe("isChannelFilterable", () => {
    it("returns true for a channel with an eBird subscription", async () => {
      await seedSubscription(db, { channelId: "CH1" });

      await expect(repository.isChannelFilterable("CH1")).resolves.toBe(true);
    });

    it("returns false for a channel with no subscription", async () => {
      await expect(repository.isChannelFilterable("UNKNOWN")).resolves.toBe(
        false,
      );
    });
  });
});
