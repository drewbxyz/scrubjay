import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as authSchema from "./auth-schema";
import { env } from "./env";

let pool: Pool | undefined;

export function getDb() {
  pool ??= new Pool({ connectionString: env().DATABASE_URL, max: 5 });
  return drizzle(pool, { schema: authSchema });
}
