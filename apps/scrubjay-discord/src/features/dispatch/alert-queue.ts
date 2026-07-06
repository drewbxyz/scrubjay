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

const CONFIRMED_WINDOW_DAYS = 7;
const MARK_SENT_BATCH_SIZE = 100;

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
  recentlyConfirmed: boolean;
  videoCount: number;
  audioCount: number;
};

export type SentAlert = {
  speciesCode: string;
  subId: string;
  channelId: string;
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
      recentlyConfirmed: sql<boolean>`exists (
        select 1
        from observations as confirmed_obs
        where confirmed_obs.species_code = ${observations.speciesCode}
          and confirmed_obs.location_id = ${observations.locId}
          and confirmed_obs.observation_valid = true
          and confirmed_obs.observation_reviewed = true
          and confirmed_obs.observation_date > now() - make_interval(days => ${CONFIRMED_WINDOW_DAYS})
      )`,
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

  /**
   * Record alerts as sent. Idempotent (unique on kind+alertId+channelId);
   * owns the alertId format — callers never build it.
   */
  async markSent(alerts: SentAlert[]): Promise<void> {
    for (let i = 0; i < alerts.length; i += MARK_SENT_BATCH_SIZE) {
      const batch = alerts.slice(i, i + MARK_SENT_BATCH_SIZE).map((alert) => ({
        alertId: `${alert.speciesCode}:${alert.subId}`,
        channelId: alert.channelId,
        kind: "ebird" as const,
      }));
      await this.drizzle.db
        .insert(deliveries)
        .values(batch)
        .onConflictDoNothing();
    }
  }
}
