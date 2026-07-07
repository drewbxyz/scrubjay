import { join } from "node:path";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

const globalWithContainer = globalThis as typeof globalThis & {
  __PG_CONTAINER__?: StartedPostgreSqlContainer;
};

export default async function globalSetup() {
  const container = await new PostgreSqlContainer("postgres:17").start();
  globalWithContainer.__PG_CONTAINER__ = container;
  process.env.TEST_DATABASE_URL = container.getConnectionUri();

  // Same migration path production takes in main.ts.
  const pool = new Pool({ connectionString: container.getConnectionUri() });
  try {
    await migrate(drizzle(pool), {
      migrationsFolder: join(__dirname, "..", "drizzle"),
    });
  } finally {
    await pool.end();
  }
}
