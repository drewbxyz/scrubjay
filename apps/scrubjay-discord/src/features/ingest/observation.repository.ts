import { Injectable } from "@nestjs/common";
import { locations, observations } from "@/core/drizzle/drizzle.schema";
import { DrizzleService } from "@/core/drizzle/drizzle.service";
import type { Observation } from "./observation.interface";

@Injectable()
export class ObservationRepository {
  constructor(private readonly drizzle: DrizzleService) {}

  /**
   * Persist one ingested observation into the normalized schema. The
   * location embedded in the eBird payload is upserted in the same
   * transaction — locations have no independent lifecycle.
   */
  async upsertObservation(data: Observation): Promise<void> {
    await this.drizzle.db.transaction(async (tx) => {
      await tx
        .insert(locations)
        .values({
          county: data.county,
          countyCode: data.countyCode,
          id: data.locId,
          isPrivate: data.isPrivate,
          lat: data.lat,
          lng: data.lng,
          name: data.locationName,
          state: data.state,
          stateCode: data.stateCode,
        })
        .onConflictDoUpdate({
          set: {
            county: data.county,
            countyCode: data.countyCode,
            isPrivate: data.isPrivate,
            lastUpdated: new Date(),
            lat: data.lat,
            lng: data.lng,
            name: data.locationName,
            state: data.state,
            stateCode: data.stateCode,
          },
          target: [locations.id],
        });

      await tx
        .insert(observations)
        .values({
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
        })
        .onConflictDoUpdate({
          set: {
            audioCount: data.audioCount,
            comName: data.comName,
            hasComments: data.hasComments,
            howMany: data.howMany,
            lastUpdated: new Date(),
            locId: data.locId,
            obsDt: data.obsDt,
            obsReviewed: data.obsReviewed,
            obsValid: data.obsValid,
            photoCount: data.photoCount,
            presenceNoted: data.presenceNoted,
            sciName: data.sciName,
            videoCount: data.videoCount,
          },
          target: [observations.speciesCode, observations.subId],
        });
    });
  }
}
