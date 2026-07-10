import { join } from "node:path";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { dbUri, TEMPLATE_DB } from "./db-helpers";

let container: StartedPostgreSqlContainer;

export async function setup() {
  container = await new PostgreSqlContainer("postgres:17").start();
  const baseUri = container.getConnectionUri();

  const adminPool = new Pool({ connectionString: baseUri });
  try {
    await adminPool.query(`CREATE DATABASE ${TEMPLATE_DB}`);
  } finally {
    await adminPool.end();
  }

  // Same migration path production takes in main.ts, applied to the template.
  const templatePool = new Pool({
    connectionString: dbUri(baseUri, TEMPLATE_DB),
  });
  try {
    await migrate(drizzle(templatePool), {
      migrationsFolder: join(process.cwd(), "src", "drizzle"),
    });
  } finally {
    await templatePool.end();
  }

  // Workers derive per-worker database names from this base URI.
  process.env.TEST_PG_BASE_URL = baseUri;
}

export async function teardown() {
  await container?.stop();
}
