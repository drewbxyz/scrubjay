import { Injectable } from "@nestjs/common";
import type {
  EBirdObservation,
  TransformedEBirdObservation,
} from "./ebird.schema";

@Injectable()
export class EBirdTransformer {
  private countMedia(observation: EBirdObservation) {
    return {
      audioCount: observation.evidence === "A" ? 1 : 0,
      photoCount: observation.evidence === "P" ? 1 : 0,
      videoCount: observation.evidence === "V" ? 1 : 0,
    };
  }

  private isPresenceNoted(curr: boolean, acc: boolean) {
    return curr || acc;
  }

  transformObservations(raw: EBirdObservation[]) {
    const reduced = raw.reduce((acc, observation) => {
      const key = `${observation.speciesCode}-${observation.subId}`;
      const mediaCounts = this.countMedia(observation);

      const existing = acc.get(key);
      if (existing) {
        acc.set(key, {
          ...existing,
          audioCount: existing.audioCount + mediaCounts.audioCount,
          photoCount: existing.photoCount + mediaCounts.photoCount,
          presenceNoted: this.isPresenceNoted(
            existing.presenceNoted,
            observation.presenceNoted,
          ),
          videoCount: existing.videoCount + mediaCounts.videoCount,
        });
      } else {
        acc.set(key, {
          ...observation,
          ...mediaCounts,
        });
      }

      return acc;
    }, new Map<string, TransformedEBirdObservation>());
    return Array.from(reduced.values());
  }
}
