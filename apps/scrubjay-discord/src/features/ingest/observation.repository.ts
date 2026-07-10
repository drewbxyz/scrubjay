import { Injectable } from "@nestjs/common";
import { getTableColumns, type SQL, sql } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { locations, observations } from "@/core/drizzle/drizzle.schema";
import { DrizzleService } from "@/core/drizzle/drizzle.service";
import type { Observation } from "./observation.interface";

/**
 * Rows per INSERT statement. Postgres caps a statement at 65,535 bind
 * parameters (~15 columns per row here). Chunks are issued inside ONE
 * transaction, so the cap never splits a batch's atomicity.
 */
const CHUNK_SIZE = 1000;

function chunk<T>(rows: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) {
    out.push(rows.slice(i, i + size));
  }
  return out;
}

/**
 * Build an onConflictDoUpdate `set` that reads each column's value from the
 * incoming row (Postgres `excluded.*`). Required for multi-row upserts,
 * where a literal value cannot vary per row.
 */
function excludedColumns<T extends PgTable>(
  table: T,
  keys: (keyof T["_"]["columns"] & string)[],
): Record<string, SQL> {
  const columns = getTableColumns(table);
  return Object.fromEntries(
    keys.map((key) => [key, sql.raw(`excluded."${columns[key].name}"`)]),
  );
}

@Injectable()
export class ObservationRepository {
  constructor(private readonly drizzle: DrizzleService) {}

  /**
   * Persist one region's ingested batch in a single transaction: bulk
   * location upsert, then bulk observation upsert. Locations are deduped
   * by id first — a multi-row INSERT ... ON CONFLICT DO UPDATE may not
   * touch the same row twice. All-or-nothing by design: the batch is
   * idempotent, so callers retry it on the next tick.
   */
  async upsertObservations(batch: Observation[]): Promise<void> {
    if (batch.length === 0) {
      return;
    }

    const locationRows = [
      ...new Map(
        batch.map((data) => [
          data.locId,
          {
            county: data.county,
            countyCode: data.countyCode,
            id: data.locId,
            isPrivate: data.isPrivate,
            lat: data.lat,
            lng: data.lng,
            name: data.locationName,
            state: data.state,
            stateCode: data.stateCode,
          },
        ]),
      ).values(),
    ];

    const observationRows = batch.map((data) => ({
      audioCount: data.audioCount,
      comName: data.comName,
      hasComments: data.hasComments,
      howMany: data.howMany,
      locId: data.locId,
      obsDt: data.obsDt,
      obsReviewed: data.obsReviewed,
      obsValid: data.obsValid,
      photoCount: data.photoCount,
      presenceNoted: data.presenceNoted,
      sciName: data.sciName,
      speciesCode: data.speciesCode,
      subId: data.subId,
      videoCount: data.videoCount,
    }));

    await this.drizzle.db.transaction(async (tx) => {
      for (const rows of chunk(locationRows, CHUNK_SIZE)) {
        await tx
          .insert(locations)
          .values(rows)
          .onConflictDoUpdate({
            set: {
              ...excludedColumns(locations, [
                "county",
                "countyCode",
                "isPrivate",
                "lat",
                "lng",
                "name",
                "state",
                "stateCode",
              ]),
              lastUpdated: new Date(),
            },
            target: [locations.id],
          });
      }

      for (const rows of chunk(observationRows, CHUNK_SIZE)) {
        await tx
          .insert(observations)
          .values(rows)
          .onConflictDoUpdate({
            set: {
              ...excludedColumns(observations, [
                "audioCount",
                "comName",
                "hasComments",
                "howMany",
                "locId",
                "obsDt",
                "obsReviewed",
                "obsValid",
                "photoCount",
                "presenceNoted",
                "sciName",
                "videoCount",
              ]),
              lastUpdated: new Date(),
            },
            target: [observations.speciesCode, observations.subId],
          });
      }
    });
  }
}
