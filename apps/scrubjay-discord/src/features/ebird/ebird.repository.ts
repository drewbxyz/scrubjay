import { Injectable } from "@nestjs/common";
import { gt } from "drizzle-orm";
import { locations, observations } from "@/core/drizzle/drizzle.schema";
import { DrizzleService } from "@/core/drizzle/drizzle.service";
import type {
  EBirdLocation,
  TransformedEBirdObservation,
} from "./ebird.schema";

@Injectable()
export class EBirdRepository {
  constructor(private readonly drizzle: DrizzleService) {}

  async upsertLocation(data: EBirdLocation) {
    return this.drizzle.db
      .insert(locations)
      .values({
        county: data.subnational2Name,
        countyCode: data.subnational2Code,
        id: data.locId,
        isPrivate: data.locationPrivate,
        lat: data.lat,
        lng: data.lng,
        name: data.locName,
        state: data.subnational1Name,
        stateCode: data.subnational1Code,
      })
      .onConflictDoUpdate({
        set: {
          county: data.subnational2Name,
          countyCode: data.subnational2Code,
          isPrivate: data.locationPrivate,
          lastUpdated: new Date(),
          lat: data.lat,
          lng: data.lng,
          name: data.locName,
          state: data.subnational1Name,
          stateCode: data.subnational1Code,
        },
        target: [locations.id],
      })
      .returning();
  }

  async upsertObservation(data: TransformedEBirdObservation) {
    return this.drizzle.db
      .insert(observations)
      .values({
        audioCount: data.audioCount,
        comName: data.comName,
        hasComments: data.hasComments,
        howMany: data.howMany ?? 0,
        locId: data.locId,
        obsDt: new Date(data.obsDt),
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
          howMany: data.howMany ?? 0,
          lastUpdated: new Date(),
          locId: data.locId,
          obsDt: new Date(data.obsDt),
          obsReviewed: data.obsReviewed,
          obsValid: data.obsValid,
          photoCount: data.photoCount,
          presenceNoted: data.presenceNoted,
          sciName: data.sciName,
          videoCount: data.videoCount,
        },
        target: [observations.speciesCode, observations.subId],
      })
      .returning();
  }

  async getAlertsCreatedSinceDate(since: Date) {
    return this.drizzle.db.query.observations.findMany({
      where: gt(observations.createdAt, since),
    });
  }
}
