import { Injectable } from "@nestjs/common";
import { and, eq } from "drizzle-orm";
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

  async channelFilters(channelId: string) {
    return this.drizzle.db
      .select()
      .from(filteredSpecies)
      .where(eq(filteredSpecies.channelId, channelId))
      .orderBy(filteredSpecies.commonName);
  }

  /** Returns whether a filter row existed to remove. */
  async removeChannelFilter(
    channelId: string,
    commonName: string,
  ): Promise<boolean> {
    const rows = await this.drizzle.db
      .delete(filteredSpecies)
      .where(
        and(
          eq(filteredSpecies.channelId, channelId),
          eq(filteredSpecies.commonName, commonName),
        ),
      )
      .returning({ channelId: filteredSpecies.channelId });
    return rows.length > 0;
  }
}
