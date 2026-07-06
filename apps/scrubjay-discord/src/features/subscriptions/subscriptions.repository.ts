import { Injectable } from "@nestjs/common";
import { and, eq, isNull, sql } from "drizzle-orm";
import {
  channelEBirdSubscriptions,
  deliveries,
  filteredSpecies,
  locations,
  observations,
} from "@/core/drizzle/drizzle.schema";
import { DrizzleService } from "@/core/drizzle/drizzle.service";

@Injectable()
export class SubscriptionsRepository {
  constructor(private readonly drizzle: DrizzleService) {}

  async insertEBirdSubscription(subscription: {
    channelId: string;
    stateCode: string;
    countyCode: string;
  }) {
    await this.drizzle.db.transaction(async (tx) => {
      await tx
        .insert(channelEBirdSubscriptions)
        .values(subscription)
        .onConflictDoNothing();

      // Find all existing undelivered observations that match this subscription
      const undeliveredObservations = await tx
        .select({
          speciesCode: observations.speciesCode,
          subId: observations.subId,
        })
        .from(observations)
        .innerJoin(locations, eq(locations.id, observations.locId))
        .innerJoin(
          channelEBirdSubscriptions,
          and(
            // Match ONLY the subscription being inserted
            eq(channelEBirdSubscriptions.channelId, subscription.channelId),
            eq(channelEBirdSubscriptions.stateCode, subscription.stateCode),
            eq(channelEBirdSubscriptions.countyCode, subscription.countyCode),
            eq(channelEBirdSubscriptions.active, true),
          ),
        )
        .leftJoin(
          filteredSpecies,
          and(
            eq(filteredSpecies.channelId, subscription.channelId),
            eq(filteredSpecies.commonName, observations.comName),
          ),
        )
        .leftJoin(
          deliveries,
          and(
            eq(deliveries.kind, "ebird"),
            eq(
              deliveries.alertId,
              sql`${observations.speciesCode} || ':' || ${observations.subId}`,
            ),
            eq(deliveries.channelId, subscription.channelId),
          ),
        )
        .where(
          and(
            eq(locations.stateCode, subscription.stateCode),
            subscription.countyCode === "*"
              ? undefined
              : eq(locations.countyCode, subscription.countyCode),
            isNull(filteredSpecies.channelId),
            isNull(deliveries.alertId),
          ),
        );

      if (undeliveredObservations.length > 0) {
        const deliveryValues = undeliveredObservations.map((obs) => ({
          alertId: `${obs.speciesCode}:${obs.subId}`,
          channelId: subscription.channelId,
          kind: "ebird" as const,
        }));

        const batchSize = 100;
        for (let i = 0; i < deliveryValues.length; i += batchSize) {
          const batch = deliveryValues.slice(i, i + batchSize);
          await tx.insert(deliveries).values(batch).onConflictDoNothing();
        }
      }
    });
  }
}
