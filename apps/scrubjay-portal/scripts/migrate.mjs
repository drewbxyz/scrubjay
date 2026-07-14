// Applies the portal's own migrations (Better Auth tables only). Runs from the
// app root: node scripts/migrate.mjs. Never touches the bot's schema.

import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 1,
});
await migrate(drizzle(pool), {
  migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),
});
await pool.end();
console.log("portal migrations applied");
