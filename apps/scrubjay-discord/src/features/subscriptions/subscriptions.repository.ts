import { Injectable } from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import { channelEBirdSubscriptions } from "@/core/drizzle/drizzle.schema";
import { DrizzleService } from "@/core/drizzle/drizzle.service";
import { AlertQueue } from "../dispatch/alert-queue.service";

@Injectable()
export class SubscriptionsRepository {
  constructor(
    private readonly drizzle: DrizzleService,
    private readonly alertQueue: AlertQueue,
  ) {}

  async insertSubscription(subscription: {
    channelId: string;
    stateCode: string;
    countyCode: string;
  }): Promise<boolean> {
    const performedInsert = await this.drizzle.db.transaction(async (tx) => {
      const inserted = await tx
        .insert(channelEBirdSubscriptions)
        .values(subscription)
        .onConflictDoNothing()
        .returning({ channelId: channelEBirdSubscriptions.channelId });

      // If already subscribed, ignore the backfill
      if (inserted.length === 0) return false;

      await this.alertQueue.backfillEBird(subscription, tx);

      return true;
    });
    return performedInsert;
  }

  /** Hard delete. Returns whether a Subscription actually existed to remove. */
  async deleteSubscription(subscription: {
    channelId: string;
    stateCode: string;
    countyCode: string;
  }): Promise<boolean> {
    const deleted = await this.drizzle.db
      .delete(channelEBirdSubscriptions)
      .where(
        and(
          eq(channelEBirdSubscriptions.channelId, subscription.channelId),
          eq(channelEBirdSubscriptions.stateCode, subscription.stateCode),
          eq(channelEBirdSubscriptions.countyCode, subscription.countyCode),
        ),
      )
      .returning({ channelId: channelEBirdSubscriptions.channelId });

    return deleted.length > 0;
  }

  async subscriptionsForChannel(channelId: string) {
    return this.drizzle.db
      .select()
      .from(channelEBirdSubscriptions)
      .where(eq(channelEBirdSubscriptions.channelId, channelId))
      .orderBy(
        channelEBirdSubscriptions.stateCode,
        channelEBirdSubscriptions.countyCode,
      );
  }
}
