import { Injectable } from "@nestjs/common";
import { type SQL, sql } from "drizzle-orm";
import { DrizzleService } from "@/core/drizzle/drizzle.service";

/** Rows per DELETE pass. Each pass is its own implicit transaction, so the
 * first run (months of backlog) never becomes one giant transaction and a
 * crash mid-prune just resumes on the next daily tick. */
export const RETENTION_BATCH_SIZE = 10_000;

/**
 * Raw data access for retention pruning. Every method returns the total
 * number of rows deleted. Deletes are keyed through a LIMITed subselect —
 * plain `DELETE ... LIMIT` is not SQL.
 */
@Injectable()
export class RetentionRepository {
  constructor(private readonly drizzle: DrizzleService) {}

  async pruneObservations(
    cutoff: Date,
    batchSize = RETENTION_BATCH_SIZE,
  ): Promise<number> {
    return this.batchedDelete(
      (limit) => sql`
        DELETE FROM observations
        WHERE (species_code, sub_id) IN (
          SELECT species_code, sub_id FROM observations
          WHERE created_at < ${cutoff}
          LIMIT ${limit}
        )`,
      batchSize,
    );
  }

  async pruneDeliveries(
    cutoff: Date,
    batchSize = RETENTION_BATCH_SIZE,
  ): Promise<number> {
    return this.batchedDelete(
      (limit) => sql`
        DELETE FROM deliveries
        WHERE id IN (
          SELECT id FROM deliveries
          WHERE sent_at IS NULL OR sent_at < ${cutoff}
          LIMIT ${limit}
        )`,
      batchSize,
    );
  }

  async pruneOrphanLocations(
    batchSize = RETENTION_BATCH_SIZE,
  ): Promise<number> {
    return this.batchedDelete(
      (limit) => sql`
        DELETE FROM locations
        WHERE id IN (
          SELECT id FROM locations
          WHERE NOT EXISTS (
            SELECT 1 FROM observations
            WHERE observations.location_id = locations.id
          )
          LIMIT ${limit}
        )`,
      batchSize,
    );
  }

  private async batchedDelete(
    buildDelete: (limit: number) => SQL,
    batchSize: number,
  ): Promise<number> {
    let total = 0;
    for (;;) {
      const result = await this.drizzle.db.execute(buildDelete(batchSize));
      const deleted = result.rowCount ?? 0;
      total += deleted;
      if (deleted < batchSize) {
        return total;
      }
    }
  }
}
