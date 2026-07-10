import { eq } from "drizzle-orm";
import type { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { locations, observations } from "@/core/drizzle/drizzle.schema";
import type { DrizzleService } from "@/core/drizzle/drizzle.service";
import { createTestDb, truncateAll } from "@/testing/db-helpers";
import type { Observation } from "./observation.interface";
import { ObservationRepository } from "./observation.repository";

const baseObservation: Observation = {
  audioCount: 0,
  comName: "Vermilion Flycatcher",
  county: "Santa Clara",
  countyCode: "US-CA-085",
  hasComments: false,
  howMany: 1,
  isPrivate: false,
  lat: 37.3,
  lng: -122.0,
  locationName: "Test Hotspot",
  locId: "L001",
  obsDt: new Date("2026-07-07T09:00:00Z"),
  obsReviewed: false,
  obsValid: false,
  photoCount: 0,
  presenceNoted: false,
  sciName: "Pyrocephalus rubinus",
  speciesCode: "verfly",
  state: "California",
  stateCode: "US-CA",
  subId: "S001",
  videoCount: 0,
};

describe("ObservationRepository", () => {
  let db: DrizzleService;
  let pool: Pool;
  let repository: ObservationRepository;

  beforeAll(async () => {
    ({ db, pool } = await createTestDb());
    repository = new ObservationRepository(db);
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await truncateAll(db);
  });

  describe("upsertObservation", () => {
    it("persists the observation and its embedded location in one call", async () => {
      await repository.upsertObservation(baseObservation);

      const location = await db.db.query.locations.findFirst({
        where: eq(locations.id, "L001"),
      });
      const observation = await db.db.query.observations.findFirst({
        where: eq(observations.subId, "S001"),
      });
      expect(location?.name).toBe("Test Hotspot");
      expect(observation?.speciesCode).toBe("verfly");
    });

    it("updates mapped columns on conflict", async () => {
      await repository.upsertObservation(baseObservation);
      await repository.upsertObservation({ ...baseObservation, howMany: 7 });

      const row = await db.db.query.observations.findFirst({
        where: eq(observations.subId, "S001"),
      });
      expect(row?.howMany).toBe(7);
    });

    it("propagates location renames and privacy changes on conflict", async () => {
      await repository.upsertObservation(baseObservation);
      await repository.upsertObservation({
        ...baseObservation,
        isPrivate: true,
        locationName: "New Name",
      });

      const row = await db.db.query.locations.findFirst({
        where: eq(locations.id, "L001"),
      });
      expect(row?.name).toBe("New Name");
      expect(row?.isPrivate).toBe(true);
    });
  });
});
