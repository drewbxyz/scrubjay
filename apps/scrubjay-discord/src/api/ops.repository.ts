import { Injectable } from "@nestjs/common";
import type {
  ListDeliveriesQuery,
  ListObservationsQuery,
} from "@scrubjay/api-contracts";
import { and, desc, eq, gt } from "drizzle-orm";
import {
  deliveries,
  locations,
  observations,
} from "@/core/drizzle/drizzle.schema";
import { DrizzleService } from "@/core/drizzle/drizzle.service";

/**
 * Read-only queries for the operator API's ops views. Pending/Delivery
 * *semantics* stay in AlertQueue — this repository only pages raw rows.
 */
@Injectable()
export class OpsRepository {
  constructor(private readonly drizzle: DrizzleService) {}

  async listObservations(query: ListObservationsQuery) {
    const conditions = [
      query.stateCode ? eq(locations.stateCode, query.stateCode) : undefined,
      query.countyCode ? eq(locations.countyCode, query.countyCode) : undefined,
      query.speciesCode
        ? eq(observations.speciesCode, query.speciesCode)
        : undefined,
      query.since
        ? gt(observations.createdAt, new Date(query.since))
        : undefined,
    ].filter((c) => c !== undefined);

    const rows = await this.drizzle.db
      .select({
        audioCount: observations.audioCount,
        comName: observations.comName,
        county: locations.county,
        countyCode: locations.countyCode,
        createdAt: observations.createdAt,
        howMany: observations.howMany,
        locationName: locations.name,
        locId: observations.locId,
        obsDt: observations.obsDt,
        obsReviewed: observations.obsReviewed,
        obsValid: observations.obsValid,
        photoCount: observations.photoCount,
        sciName: observations.sciName,
        speciesCode: observations.speciesCode,
        state: locations.state,
        stateCode: locations.stateCode,
        subId: observations.subId,
        videoCount: observations.videoCount,
      })
      .from(observations)
      .innerJoin(locations, eq(locations.id, observations.locId))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(observations.createdAt))
      .limit(query.limit + 1)
      .offset(query.offset);

    return {
      hasMore: rows.length > query.limit,
      observations: rows.slice(0, query.limit),
    };
  }

  async listDeliveries(query: ListDeliveriesQuery) {
    const conditions = [
      query.channelId ? eq(deliveries.channelId, query.channelId) : undefined,
      query.status ? eq(deliveries.status, query.status) : undefined,
    ].filter((c) => c !== undefined);

    const rows = await this.drizzle.db
      .select()
      .from(deliveries)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(deliveries.sentAt), desc(deliveries.id))
      .limit(query.limit + 1)
      .offset(query.offset);

    return {
      deliveries: rows.slice(0, query.limit),
      hasMore: rows.length > query.limit,
    };
  }
}
