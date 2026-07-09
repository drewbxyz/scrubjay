import { Injectable } from "@nestjs/common";
import type { EBirdObservation } from "./ebird.schema";
import type { Observation } from "./observation.interface";

@Injectable()
export class EBirdTransformer {
  /**
   * The eBird→domain translation line: dedupes reports per
   * species × checklist, tallies media evidence into counts, and renames
   * vendor vocabulary to domain vocabulary. Everything downstream speaks
   * Observation, not eBird.
   */
  transformObservations(raw: EBirdObservation[]): Observation[] {
    const reduced = raw.reduce((acc, row) => {
      const key = `${row.speciesCode}-${row.subId}`;
      const existing = acc.get(key);

      if (existing) {
        existing.audioCount += row.evidence === "A" ? 1 : 0;
        existing.photoCount += row.evidence === "P" ? 1 : 0;
        existing.videoCount += row.evidence === "V" ? 1 : 0;
        existing.presenceNoted = existing.presenceNoted || row.presenceNoted;
      } else {
        acc.set(key, this.toObservation(row));
      }

      return acc;
    }, new Map<string, Observation>());
    return Array.from(reduced.values());
  }

  private toObservation(row: EBirdObservation): Observation {
    return {
      audioCount: row.evidence === "A" ? 1 : 0,
      comName: row.comName,
      county: row.subnational2Name,
      countyCode: row.subnational2Code,
      hasComments: row.hasComments,
      howMany: row.howMany ?? 0,
      isPrivate: row.locationPrivate,
      lat: row.lat,
      lng: row.lng,
      locationName: row.locName,
      locId: row.locId,
      obsDt: new Date(row.obsDt),
      obsReviewed: row.obsReviewed,
      obsValid: row.obsValid,
      photoCount: row.evidence === "P" ? 1 : 0,
      presenceNoted: row.presenceNoted,
      sciName: row.sciName,
      speciesCode: row.speciesCode,
      state: row.subnational1Name,
      stateCode: row.subnational1Code,
      subId: row.subId,
      videoCount: row.evidence === "V" ? 1 : 0,
    };
  }
}
