import { Injectable } from "@nestjs/common";
import { count, gte } from "drizzle-orm";
import {
  deliveries,
  type DeliveryStatus,
} from "@/core/drizzle/drizzle.schema";
import { DrizzleService } from "@/core/drizzle/drizzle.service";

export const DELIVERY_COUNT_WINDOW_MS = 24 * 60 * 60 * 1000;

export type DeliveryCounts = Record<DeliveryStatus, number>;

/**
 * Read-only health queries. Lives here (not features/dispatch) so HealthModule
 * depends only on core/drizzle — no cross-feature import (spec §1).
 */
@Injectable()
export class HealthRepository {
  constructor(private readonly drizzle: DrizzleService) {}

  async recentDeliveryCounts(): Promise<DeliveryCounts> {
    const since = new Date(Date.now() - DELIVERY_COUNT_WINDOW_MS);
    const rows = await this.drizzle.db
      .select({ n: count(), status: deliveries.status })
      .from(deliveries)
      .where(gte(deliveries.sentAt, since))
      .groupBy(deliveries.status);

    const counts: DeliveryCounts = {
      expired: 0,
      failed: 0,
      sent: 0,
      suppressed: 0,
    };
    for (const row of rows) {
      counts[row.status] = row.n;
    }
    return counts;
  }
}
