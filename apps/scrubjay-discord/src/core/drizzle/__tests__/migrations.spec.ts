import { sql } from "drizzle-orm";
import { createTestDb } from "@/testing/db-helpers";

describe("migrations", () => {
  it("creates the expected tables", async () => {
    const { db, pool } = createTestDb();
    try {
      const result = await db.db.execute(
        sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`,
      );
      const tables = result.rows.map((row) => row.table_name);

      expect(tables).toEqual(
        expect.arrayContaining([
          "observations",
          "locations",
          "channel_ebird_subscriptions",
          "filtered_species",
          "deliveries",
        ]),
      );
    } finally {
      await pool.end();
    }
  });
});
