import { createFileRoute } from "@tanstack/react-router";
import { sql } from "drizzle-orm";
import { getDb } from "@/server/db";

// Bound the DB probe so a hung connection can't stall the health check past
// Docker's HEALTHCHECK timeout (5s) — a slow/dead DB should surface as 503
// rather than a killed probe.
const HEALTH_QUERY_TIMEOUT_MS = 4000;

export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: async () => {
        const probe = Promise.resolve(getDb().execute(sql`select 1`));
        // Keep a late rejection handled if the timeout wins the race first.
        probe.catch(() => {});
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([
            probe,
            new Promise<never>((_, reject) => {
              timer = setTimeout(
                () => reject(new Error("health check query timed out")),
                HEALTH_QUERY_TIMEOUT_MS,
              );
            }),
          ]);
          return Response.json({ status: "ok" });
        } catch {
          return Response.json({ status: "unavailable" }, { status: 503 });
        } finally {
          clearTimeout(timer);
        }
      },
    },
  },
});
