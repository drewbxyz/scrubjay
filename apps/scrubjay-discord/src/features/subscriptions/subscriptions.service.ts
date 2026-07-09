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

  async subscribeToEBird(channelId: string, regionCode: string) {
    const { countyCode, stateCode } = this.parseRegionCode(regionCode);
    await this.repo.insertEBirdSubscription({
      channelId,
      countyCode,
      stateCode,
    });
  }
}
