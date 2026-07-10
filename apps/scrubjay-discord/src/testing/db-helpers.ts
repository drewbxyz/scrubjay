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

export const TEMPLATE_DB = "scrubjay_template";

const ENSURE_DB_LOCK = 727_001;

export function dbUri(baseUri: string, dbName: string): string {
  const url = new URL(baseUri);
  url.pathname = `/${dbName}`;
  return url.toString();
}

async function ensureWorkerDatabase(baseUri: string, dbName: string) {
  // Serialize CREATE DATABASE calls: concurrent clones of the same template
  // fail in Postgres, and pg advisory locks are session-scoped, so lock and
  // unlock must happen on one dedicated client.
  const pool = new Pool({ connectionString: baseUri, max: 1 });
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [ENSURE_DB_LOCK]);
    try {
      const existing = await client.query(
        "SELECT 1 FROM pg_database WHERE datname = $1",
        [dbName],
      );
      if (existing.rowCount === 0) {
        await client.query(`CREATE DATABASE ${dbName} TEMPLATE ${TEMPLATE_DB}`);
      }
    } finally {
      await client.query("SELECT pg_advisory_unlock($1)", [ENSURE_DB_LOCK]);
    }
  } finally {
    client.release();
    await pool.end();
  }
}

export async function createTestDb() {
  const baseUri = process.env.TEST_PG_BASE_URL;
  if (!baseUri) {
    throw new Error("TEST_PG_BASE_URL not set — is global-setup configured?");
  }
  const dbName = `test_${process.env.VITEST_POOL_ID ?? "0"}`;
  await ensureWorkerDatabase(baseUri, dbName);

  const pool = new Pool({ connectionString: dbUri(baseUri, dbName) });
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
