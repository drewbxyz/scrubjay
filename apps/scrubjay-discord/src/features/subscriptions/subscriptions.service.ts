import { Injectable } from "@nestjs/common";
import { InvalidRegionError } from "./invalid-region.error";
import { SubscriptionsRepository } from "./subscriptions.repository";

// eBird codes: 2-letter country + 1 or 2 subnational segments, e.g.
// US-CA (state) or US-CA-085 (county). Bare country codes are rejected.
const REGION_PATTERN = /^[A-Z]{2}(-[A-Z0-9]+){1,2}$/;

@Injectable()
export class SubscriptionsService {
  constructor(private readonly repo: SubscriptionsRepository) {}

  private parseRegionCode(regionCode: string) {
    const normalized = regionCode.trim().toUpperCase();
    if (!REGION_PATTERN.test(normalized)) {
      throw new InvalidRegionError(regionCode);
    }

    const parts = normalized.split("-");
    if (parts.length === 2) {
      return {
        countyCode: "*",
        stateCode: normalized,
      };
    }
    // The pattern guarantees exactly 2 or 3 parts here.
    return {
      countyCode: normalized,
      stateCode: `${parts[0]}-${parts[1]}`,
    };
  }

  async subscribe(channelId: string, regionCode: string): Promise<boolean> {
    const { countyCode, stateCode } = this.parseRegionCode(regionCode);
    return this.repo.insertSubscription({ channelId, countyCode, stateCode });
  }

  async unsubscribe(channelId: string, regionCode: string): Promise<boolean> {
    const { countyCode, stateCode } = this.parseRegionCode(regionCode);
    return this.repo.deleteSubscription({ channelId, countyCode, stateCode });
  }

  async listSubscriptions(channelId: string) {
    return this.repo.subscriptionsForChannel(channelId);
  }
}
