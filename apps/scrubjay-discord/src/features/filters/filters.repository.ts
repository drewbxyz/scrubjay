import { Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";
import {
  channelEBirdSubscriptions,
  filteredSpecies,
} from "@/core/drizzle/drizzle.schema";
import { DrizzleService } from "@/core/drizzle/drizzle.service";

@Injectable()
export class FiltersRepository {
  constructor(private readonly drizzle: DrizzleService) {}

  async isChannelFilterable(channelId: string) {
    const channelMeta =
      await this.drizzle.db.query.channelEBirdSubscriptions.findFirst({
        where: eq(channelEBirdSubscriptions.channelId, channelId),
      });
    return !!channelMeta;
  }

  async addChannelFilter(channelId: string, commonName: string) {
    return this.drizzle.db
      .insert(filteredSpecies)
      .values({
        channelId,
        commonName,
      })
      .onConflictDoNothing()
      .returning();
  }
}
