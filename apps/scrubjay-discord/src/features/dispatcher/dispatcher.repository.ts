import { Injectable } from "@nestjs/common";
import { and, eq, gt, isNull, or, sql } from "drizzle-orm";
import {
  channelEBirdSubscriptions,
  deliveries,
  filteredSpecies,
  locations,
  observations,
} from "@/core/drizzle/drizzle.schema";
import { DrizzleService } from "@/core/drizzle/drizzle.service";

@Injectable()
export class DispatcherRepository {
  constructor(private readonly drizzle: DrizzleService) {}

  async getConfirmedSinceDate(since: Date) {
    return this.drizzle.db
      .selectDistinct({
        locId: observations.locId,
        speciesCode: observations.speciesCode,
      })
      .from(observations)
      .where(
        and(
          gt(observations.obsDt, since),
          eq(observations.obsValid, true),
          eq(observations.obsReviewed, true),
        ),
      );
  }

  async getUndeliveredObservationsSinceDate(since?: Date) {
    return this.drizzle.db
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
}
