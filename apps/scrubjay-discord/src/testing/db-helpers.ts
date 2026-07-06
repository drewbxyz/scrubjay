import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "@/core/drizzle/drizzle.schema";
import {
  channelEBirdSubscriptions,
  deliveries,
  filteredSpecies,
  locations,
  observations,
} from "@/core/drizzle/drizzle.schema";
import { DrizzleService } from "@/core/drizzle/drizzle.service";

export function createTestDb() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error("TEST_DATABASE_URL not set — is global-setup configured?");
  }
  const pool = new Pool({ connectionString: url });
  const db = new DrizzleService(drizzle(pool, { schema }));
  return { db, pool };
}

export async function truncateAll(db: DrizzleService) {
  await db.db.execute(
    sql`TRUNCATE observations, locations, channel_ebird_subscriptions, filtered_species, deliveries CASCADE`,
  );
}

export async function seedLocation(
  db: DrizzleService,
  overrides: Partial<typeof locations.$inferInsert> = {},
) {
  const row = {
    county: "Santa Clara",
    countyCode: "US-CA-085",
    id: "L001",
    isPrivate: false,
    lat: 37.3,
    lng: -122.0,
    name: "Test Hotspot",
    state: "California",
    stateCode: "US-CA",
    ...overrides,
  };
  await db.db.insert(locations).values(row).onConflictDoNothing();
  return row;
}

export async function seedObservation(
  db: DrizzleService,
  overrides: Partial<typeof observations.$inferInsert> = {},
) {
  const row = {
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
    subId: "S001",
    videoCount: 0,
    ...overrides,
  };
  await db.db.insert(observations).values(row);
  return row;
}

export async function seedSubscription(
  db: DrizzleService,
  overrides: Partial<typeof channelEBirdSubscriptions.$inferInsert> = {},
) {
  const row = {
    active: true,
    channelId: "CH1",
    countyCode: "US-CA-085",
    stateCode: "US-CA",
    ...overrides,
  };
  await db.db.insert(channelEBirdSubscriptions).values(row);
  return row;
}

export async function seedFilter(
  db: DrizzleService,
  overrides: Partial<typeof filteredSpecies.$inferInsert> = {},
) {
  const row = {
    channelId: "CH1",
    commonName: "Vermilion Flycatcher",
    ...overrides,
  };
  await db.db.insert(filteredSpecies).values(row);
  return row;
}

export async function seedDelivery(
  db: DrizzleService,
  overrides: Partial<typeof deliveries.$inferInsert> = {},
) {
  const row = {
    alertId: "verfly:S001",
    channelId: "CH1",
    kind: "ebird",
    ...overrides,
  };
  await db.db.insert(deliveries).values(row);
  return row;
}
