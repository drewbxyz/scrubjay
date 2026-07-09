import { eq } from "drizzle-orm";
import type { Pool } from "pg";
import { locations, observations } from "@/core/drizzle/drizzle.schema";
import type { DrizzleService } from "@/core/drizzle/drizzle.service";
import { createTestDb, seedLocation, truncateAll } from "@/testing/db-helpers";
import type { TransformedEBirdObservation } from "../ebird.schema";
import { ObservationRepository } from "../observation.repository";

const baseObservation: TransformedEBirdObservation = {
  audioCount: 0,
  checklistId: "CL1",
  comName: "Vermilion Flycatcher",
  countryCode: "US",
  countryName: "United States",
  firstName: "",
  hasComments: false,
  hasRichMedia: false,
  howMany: 1,
  lastName: "",
  lat: 37.3,
  lng: -122.0,
  locationPrivate: false,
  locId: "L001",
  locName: "Test Hotspot",
  obsDt: "2026-07-07 09:00",
  obsId: "OBS1",
  obsReviewed: false,
  obsValid: false,
  photoCount: 0,
  presenceNoted: false,
  sciName: "Pyrocephalus rubinus",
  speciesCode: "verfly",
  subId: "S001",
  subnational1Code: "US-CA",
  subnational1Name: "California",
  subnational2Code: "US-CA-085",
  subnational2Name: "Santa Clara",
  userDisplayName: "",
  videoCount: 0,
};

describe("ObservationRepository", () => {
  let db: DrizzleService;
  let pool: Pool;
  let repository: ObservationRepository;

  beforeAll(() => {
    ({ db, pool } = createTestDb());
    repository = new ObservationRepository(db);
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await truncateAll(db);
  });

  describe("upsertLocation", () => {
    it("propagates renames and privacy changes on conflict", async () => {
      const observationAtL100: TransformedEBirdObservation = {
        ...baseObservation,
        locId: "L100",
        locName: "Old Name",
      };
      await repository.upsertLocation(observationAtL100);
      await repository.upsertLocation({
        ...observationAtL100,
        locationPrivate: true,
        locName: "New Name",
      });

      const row = await db.db.query.locations.findFirst({
        where: eq(locations.id, "L100"),
      });
      expect(row?.name).toBe("New Name");
      expect(row?.isPrivate).toBe(true);
    });
  });

  describe("upsertObservation", () => {
    it("updates mapped columns on conflict", async () => {
      await seedLocation(db); // provides locId L001 for the FK
      await repository.upsertObservation(baseObservation);
      await repository.upsertObservation({ ...baseObservation, howMany: 7 });

      const row = await db.db.query.observations.findFirst({
        where: eq(observations.subId, "S001"),
      });
      expect(row?.howMany).toBe(7);
    });
  });
});
