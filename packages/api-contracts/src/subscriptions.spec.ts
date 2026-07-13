import { describe, expect, it } from "vitest";
import {
  createSubscriptionBodySchema,
  listSubscriptionsQuerySchema,
  subscriptionRegionKeySchema,
  subscriptionSchema,
  updateSubscriptionBodySchema,
  updateSubscriptionResponseSchema,
} from "./subscriptions.js";

describe("subscription contracts", () => {
  it("parses a wire-format subscription (dates as ISO strings)", () => {
    const parsed = subscriptionSchema.parse({
      active: true,
      channelId: "123",
      countyCode: "US-CA-085",
      lastUpdated: "2026-07-13T00:00:00.000Z",
      stateCode: "US-CA",
    });
    expect(parsed.countyCode).toBe("US-CA-085");
  });

  it("accepts a create body of just a region code", () => {
    expect(createSubscriptionBodySchema.parse({ regionCode: "US-CA" })).toEqual(
      {
        regionCode: "US-CA",
      },
    );
  });

  it("rejects a create body without regionCode", () => {
    expect(createSubscriptionBodySchema.safeParse({}).success).toBe(false);
  });

  it("defaults list query filters to absent", () => {
    expect(listSubscriptionsQuerySchema.parse({})).toEqual({});
  });

  it("rejects a non-snowflake channelId filter on the list query", () => {
    expect(
      listSubscriptionsQuerySchema.safeParse({ channelId: "CH1" }).success,
    ).toBe(false);
    expect(
      listSubscriptionsQuerySchema.safeParse({
        channelId: "123456789012345678",
      }).success,
    ).toBe(true);
  });

  it("addresses a subscription by its split region key", () => {
    expect(
      subscriptionRegionKeySchema.parse({
        countyCode: "*",
        stateCode: "US-CA",
      }),
    ).toEqual({ countyCode: "*", stateCode: "US-CA" });
  });

  it("requires the split region key plus active on update", () => {
    expect(
      updateSubscriptionBodySchema.safeParse({
        active: false,
        stateCode: "US-CA",
      }).success,
    ).toBe(false);
  });

  it("wraps a wire-format subscription in the update response", () => {
    const parsed = updateSubscriptionResponseSchema.parse({
      subscription: {
        active: false,
        channelId: "123",
        countyCode: "US-CA-085",
        lastUpdated: "2026-07-13T00:00:00.000Z",
        stateCode: "US-CA",
      },
    });
    expect(parsed.subscription.active).toBe(false);
  });
});
