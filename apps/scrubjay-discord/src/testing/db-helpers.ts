import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "@/core/drizzle/drizzle.schema";
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
