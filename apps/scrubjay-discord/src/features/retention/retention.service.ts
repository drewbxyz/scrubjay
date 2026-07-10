import { Injectable, Logger } from "@nestjs/common";
import { RetentionRepository } from "./retention.repository";

/**
 * Floor is the eBird `back=7` lookback: the fetch re-sends every observation
 * with obsDt in the last 7 days, and the ingest upsert preserves createdAt
 * on conflict — but only for rows that still EXIST. Pruning a row inside the
 * lookback re-inserts it next tick with a fresh createdAt, re-entering the
 * dispatch window (double post). obsDt ≤ first-ingest time (±1 day of
 * site-TZ skew), so 14 days of createdAt clears the lookback AND the 7-day
 * recentlyConfirmed window with margin.
 */
export const OBSERVATION_RETENTION_DAYS = 14;

/**
 * Ops history only — nothing reads past the health endpoint's 24h counts.
 * Hard floor is 8 days (the expired sweep scans createdAt back 7 days; a
 * missing delivery row inside that span fabricates 'expired' outcomes).
 */
export const DELIVERY_RETENTION_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class RetentionService {
  private readonly logger = new Logger(RetentionService.name);

  constructor(private readonly repository: RetentionRepository) {}

  /**
   * Prune order matters only for locations: the orphan anti-join must see
   * the freshly pruned observations, so observations go first.
   */
  async prune(): Promise<void> {
    const now = Date.now();

    const observations = await this.repository.pruneObservations(
      new Date(now - OBSERVATION_RETENTION_DAYS * DAY_MS),
    );
    this.logger.log(
      `Pruned ${observations} observation(s) older than ${OBSERVATION_RETENTION_DAYS} days`,
    );

    const deliveries = await this.repository.pruneDeliveries(
      new Date(now - DELIVERY_RETENTION_DAYS * DAY_MS),
    );
    this.logger.log(
      `Pruned ${deliveries} deliver(y/ies) older than ${DELIVERY_RETENTION_DAYS} days`,
    );

    const locations = await this.repository.pruneOrphanLocations();
    this.logger.log(`Pruned ${locations} orphaned location(s)`);
  }
}
