import { Injectable } from "@nestjs/common";
import { channelEBirdSubscriptions } from "@/core/drizzle/drizzle.schema";
import { DrizzleService } from "@/core/drizzle/drizzle.service";

@Injectable()
export class SourcesRepository {
  constructor(private readonly drizzle: DrizzleService) {}

  async getEBirdSources() {
    const vals = await this.drizzle.db
      .selectDistinct({
        stateCode: channelEBirdSubscriptions.stateCode,
      })
      .from(channelEBirdSubscriptions);

    return vals.map((row) => row.stateCode);
  }
}
