import { createFileRoute } from "@tanstack/react-router";
import { sql } from "drizzle-orm";
import { getDb } from "@/server/db";

export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: async () => {
        try {
          await getDb().execute(sql`select 1`);
          return Response.json({ status: "ok" });
        } catch {
          return Response.json({ status: "unavailable" }, { status: 503 });
        }
      },
    },
  },
});
