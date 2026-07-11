import type { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { channelEBirdSubscriptions } from "@/core/drizzle/drizzle.schema";
import type { DrizzleService } from "@/core/drizzle/drizzle.service";
import { createTestDb, truncateAll } from "@/testing/db-helpers";
import { SourcesRepository } from "./sources.repository";

describe("SourcesRepository", () => {
  let db: DrizzleService;
  let pool: Pool;
  let repository: SourcesRepository;

  beforeAll(async () => {
    ({ db, pool } = await createTestDb());
    repository = new SourcesRepository(db);
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await truncateAll(db);
  });

  describe("getEBirdSources", () => {
    it("returns an empty list when no channel is subscribed", async () => {
      expect(await repository.getEBirdSources()).toEqual([]);
    });

    it("collapses duplicate state codes to one entry per state", async () => {
      // Three subscriptions, two of them in US-WA (different channels and
      // counties). Ingestion is per state, so US-WA must appear once.
      await db.db.insert(channelEBirdSubscriptions).values([
        { channelId: "chan-1", countyCode: "US-WA-033", stateCode: "US-WA" },
        { channelId: "chan-2", countyCode: "*", stateCode: "US-WA" },
        { channelId: "chan-3", countyCode: "US-CA-085", stateCode: "US-CA" },
      ]);

      const sources = await repository.getEBirdSources();

      expect([...sources].sort()).toEqual(["US-CA", "US-WA"]);
    });

    it("surfaces a state whose only subscription is inactive (ingestion is not gated on active)", async () => {
      // Documents current behavior: getEBirdSources does not filter on
      // `active`, so a deactivated channel still keeps its state ingested.
      await db.db.insert(channelEBirdSubscriptions).values({
        active: false,
        channelId: "chan-1",
        countyCode: "*",
        stateCode: "US-OR",
      });

      expect(await repository.getEBirdSources()).toEqual(["US-OR"]);
    });
  });
});
