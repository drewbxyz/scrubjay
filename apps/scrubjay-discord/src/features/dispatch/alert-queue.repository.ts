import { Injectable } from "@nestjs/common";
import { and, eq, gt, isNull, or, sql } from "drizzle-orm";
import {
  channelEBirdSubscriptions,
  deliveries,
  filteredSpecies,
  locations,
  observations,
} from "@/core/drizzle/drizzle.schema";
import { DrizzleService, type DbOrTx } from "@/core/drizzle/drizzle.service";

const CONFIRMED_WINDOW_DAYS = 7;

/**
 * Narrows the pending-alert match to one Subscription row (not just a channel —
 * a channel can hold several Subscriptions, and a channelId-only filter would
 * sweep up another Subscription's genuinely-new pending alerts, e.g. during a
 * subscribe-time backfill).
 */
export type SubscriptionScope = {
  channelId: string;
  stateCode: string;
  countyCode: string;
};

export type PendingEBirdAlert = {
  channelId: string;
  speciesCode: string;
  comName: string;
  sciName: string;
  subId: string;
  locId: string;
  locationName: string;
  county: string;
  state: string;
  isPrivate: boolean;
  howMany: number;
  obsDt: Date;
  createdAt: Date;
  photoCount: number;
  recentlyConfirmed: boolean;
  videoCount: number;
  audioCount: number;
};

export type DeliveryRow = {
  alertId: string;
  channelId: string;
  kind: "ebird";
};

/** The `alert_id` stored in `deliveries`: `speciesCode:subId`. */
const alertIdExpr = sql<string>`${observations.speciesCode} || ':' || ${observations.subId}`;

/**
 * Raw data access for AlertQueue. Consumed only by AlertQueue and by this
 * repository's own tests — the matching/filtering/delivery semantics live in
 * the query itself, but callers reach them through AlertQueue's interface.
 */
@Injectable()
export class AlertQueueRepository {
  constructor(private readonly drizzle: DrizzleService) {}

  async pendingEBirdAlerts(
    since?: Date,
    db: DbOrTx = this.drizzle.db,
  ): Promise<PendingEBirdAlert[]> {
    return this.buildPendingEBirdAlertsQuery(since, db);
  }

  async insertDeliveries(rows: DeliveryRow[]): Promise<void> {
    if (rows.length === 0) return;
    await this.drizzle.db.insert(deliveries).values(rows).onConflictDoNothing();
  }

  /**
   * Subscribe-time backfill: record every currently-pending alert for one
   * Subscription as delivered, without sending it. The match runs in Postgres
   * and projects only the delivery identity (no wide row, no recentlyConfirmed
   * probe), so the round-trip is a compact key list. Takes `db` so it composes
   * inside the subscribe transaction — a dispatch tick landing between the
   * subscription insert and this call must not see the Subscription as
   * un-backfilled and actually send its history.
   */
  async backfillDeliveries(
    scope: SubscriptionScope,
    db: DbOrTx = this.drizzle.db,
  ): Promise<void> {
    const pending = await db
      .select({
        alertId: alertIdExpr,
        channelId: channelEBirdSubscriptions.channelId,
      })
      .from(observations)
      .innerJoin(locations, eq(locations.id, observations.locId))
      .innerJoin(channelEBirdSubscriptions, this.subscriptionMatch())
      .leftJoin(filteredSpecies, this.filteredSpeciesMatch())
      .leftJoin(deliveries, this.priorDeliveryMatch())
      .where(this.pendingWhere(undefined, scope));

    if (pending.length === 0) return;

    await db
      .insert(deliveries)
      .values(pending.map((row) => ({ ...row, kind: "ebird" as const })))
      .onConflictDoNothing();
  }

  /**
   * Unexecuted query builder, for the EXPLAIN smoke test in
   * alert-queue.repository.spec.ts — everything else awaits
   * `pendingEBirdAlerts` instead.
   */
  buildPendingEBirdAlertsQuery(since?: Date, db: DbOrTx = this.drizzle.db) {
    return db
      .select({
        audioCount: observations.audioCount,
        channelId: channelEBirdSubscriptions.channelId,
        comName: observations.comName,
        county: locations.county,
        createdAt: observations.createdAt,
        howMany: observations.howMany,
        isPrivate: locations.isPrivate,
        locationName: locations.name,
        locId: observations.locId,
        obsDt: observations.obsDt,
        photoCount: observations.photoCount,
        recentlyConfirmed: sql<boolean>`exists (
        select 1
        from observations as confirmed_obs
        where confirmed_obs.species_code = ${observations.speciesCode}
          and confirmed_obs.location_id = ${observations.locId}
          and confirmed_obs.observation_valid = true
          and confirmed_obs.observation_reviewed = true
          and confirmed_obs.observation_date > now() - make_interval(days => ${CONFIRMED_WINDOW_DAYS})
      )`,
        sciName: observations.sciName,
        speciesCode: observations.speciesCode,
        state: locations.state,
        subId: observations.subId,
        videoCount: observations.videoCount,
      })
      .from(observations)
      .innerJoin(locations, eq(locations.id, observations.locId))
      .innerJoin(channelEBirdSubscriptions, this.subscriptionMatch())
      .leftJoin(filteredSpecies, this.filteredSpeciesMatch())
      .leftJoin(deliveries, this.priorDeliveryMatch())
      .where(this.pendingWhere(since));
  }

  // --- Matching semantics, single-sourced ---------------------------------
  // The join skeleton (which tables relate) is mechanical and written at each
  // call site; every condition that could carry a bug lives here, once.

  /** An observation's location falls under an active Subscription's region. */
  private subscriptionMatch() {
    return and(
      eq(channelEBirdSubscriptions.active, true),
      eq(channelEBirdSubscriptions.stateCode, locations.stateCode),
      or(
        eq(channelEBirdSubscriptions.countyCode, locations.countyCode),
        eq(channelEBirdSubscriptions.countyCode, "*"),
      ),
    );
  }

  /** A filter suppresses this species on the matched channel. */
  private filteredSpeciesMatch() {
    return and(
      eq(filteredSpecies.channelId, channelEBirdSubscriptions.channelId),
      eq(filteredSpecies.commonName, observations.comName),
    );
  }

  /** A delivery already records this alert for the matched channel. */
  private priorDeliveryMatch() {
    return and(
      eq(deliveries.kind, "ebird"),
      eq(deliveries.alertId, alertIdExpr),
      eq(deliveries.channelId, channelEBirdSubscriptions.channelId),
    );
  }

  /**
   * An observation is pending when it is within the ingest window (if given),
   * inside the requested Subscription scope (if given), not filtered, and not
   * already delivered — the last two read the outer-joined rows as absent.
   */
  private pendingWhere(since?: Date, scope?: SubscriptionScope) {
    return and(
      since ? gt(observations.createdAt, since) : undefined,
      scope
        ? and(
            eq(channelEBirdSubscriptions.channelId, scope.channelId),
            eq(channelEBirdSubscriptions.stateCode, scope.stateCode),
            eq(channelEBirdSubscriptions.countyCode, scope.countyCode),
          )
        : undefined,
      isNull(filteredSpecies.channelId),
      isNull(deliveries.alertId),
    );
  }
}
