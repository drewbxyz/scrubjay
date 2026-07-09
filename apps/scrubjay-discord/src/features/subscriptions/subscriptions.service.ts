import { Injectable } from "@nestjs/common";
import { InvalidRegionError } from "./invalid-region.error";
import { SubscriptionsRepository } from "./subscriptions.repository";

@Injectable()
export class SubscriptionsService {
  constructor(private readonly repo: SubscriptionsRepository) {}

  private parseRegionCode(regionCode: string) {
    const parts = regionCode.split("-");
    if (parts.length === 2) {
      return {
        countyCode: "*",
        stateCode: regionCode,
      };
    }
    if (parts.length === 3) {
      return {
        countyCode: regionCode,
        stateCode: `${parts[0]}-${parts[1]}`,
      };
    }
    throw new InvalidRegionError(regionCode);
  }

  async subscribe(channelId: string, regionCode: string): Promise<boolean> {
    const { countyCode, stateCode } = this.parseRegionCode(regionCode);
    return this.repo.insertSubscription({ channelId, stateCode, countyCode });
  }

  async unsubscribe(channelId: string, regionCode: string): Promise<boolean> {
    const { countyCode, stateCode } = this.parseRegionCode(regionCode);
    return this.repo.deleteSubscription({ channelId, stateCode, countyCode });
  }

  async listSubscriptions(channelId: string) {
    return this.repo.subscriptionsForChannel(channelId);
  }
}
