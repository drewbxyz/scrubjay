import { Injectable } from "@nestjs/common";
import { and, eq, gt, isNull, or, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/core/drizzle/drizzle.schema";
import {
  channelEBirdSubscriptions,
  deliveries,
  filteredSpecies,
  locations,
  observations,
} from "@/core/drizzle/drizzle.schema";
import { DrizzleService } from "@/core/drizzle/drizzle.service";

export type PendingEBirdAlert = {
  channelId: string;
  speciesCode: string;
  comName: string;
  sciName: string;
  subId: string;
  locId: string;
  locationName: string;
  county: string;
  state: string;
  isPrivate: boolean;
  howMany: number;
  obsDt: Date;
  createdAt: Date;
  photoCount: number;
  videoCount: number;
  audioCount: number;
};

/**
 * Exported for the EXPLAIN smoke test. Production code goes through AlertQueue.
 */
export function pendingEBirdAlertsQuery(
  db: NodePgDatabase<typeof schema>,
  since?: Date,
) {
  return db
    .select({
      audioCount: observations.audioCount,
      channelId: channelEBirdSubscriptions.channelId,
      comName: observations.comName,
      county: locations.county,
      createdAt: observations.createdAt,
      howMany: observations.howMany,
      isPrivate: locations.isPrivate,
      locationName: locations.name,
      locId: observations.locId,
      obsDt: observations.obsDt,
      photoCount: observations.photoCount,
      sciName: observations.sciName,
      speciesCode: observations.speciesCode,
      state: locations.state,
      subId: observations.subId,
      videoCount: observations.videoCount,
    })
    .from(observations)
    .innerJoin(locations, eq(locations.id, observations.locId))
    .innerJoin(
      channelEBirdSubscriptions,
      and(
        eq(channelEBirdSubscriptions.active, true),
        eq(channelEBirdSubscriptions.stateCode, locations.stateCode),
        or(
          eq(channelEBirdSubscriptions.countyCode, locations.countyCode),
          eq(channelEBirdSubscriptions.countyCode, "*"),
        ),
      ),
    )
    .leftJoin(
      filteredSpecies,
      and(
        eq(filteredSpecies.channelId, channelEBirdSubscriptions.channelId),
        eq(filteredSpecies.commonName, observations.comName),
      ),
    )
    .leftJoin(
      deliveries,
      and(
        eq(deliveries.kind, "ebird"),
        eq(
          deliveries.alertId,
          sql`${observations.speciesCode} || ':' || ${observations.subId}`,
        ),
        eq(deliveries.channelId, channelEBirdSubscriptions.channelId),
      ),
    )
    .where(
      and(
        since ? gt(observations.createdAt, since) : undefined,
        isNull(filteredSpecies.channelId),
        isNull(deliveries.alertId),
      ),
    );
}

/**
 * The dispatch module's seam: decides which alerts are pending and records
 * which were sent. An alert is pending for a channel when the observation
 * matches an active subscription, the species is not filtered on that
 * channel, and no delivery exists yet.
 */
@Injectable()
export class AlertQueue {
  constructor(private readonly drizzle: DrizzleService) {}

  async pendingEBirdAlerts(since?: Date): Promise<PendingEBirdAlert[]> {
    return pendingEBirdAlertsQuery(this.drizzle.db, since);
  }
}
