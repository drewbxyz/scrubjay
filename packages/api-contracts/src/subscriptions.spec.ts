import { describe, expect, it } from "vitest";
import {
  createSubscriptionBodySchema,
  listSubscriptionsQuerySchema,
  subscriptionSchema,
  updateSubscriptionBodySchema,
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

  it("rejects a create body without regionCode", () => {
    expect(
      createSubscriptionBodySchema.safeParse({ channelId: "123" }).success,
    ).toBe(false);
  });

  it("defaults list query filters to absent", () => {
    expect(listSubscriptionsQuerySchema.parse({})).toEqual({});
  });

  it("requires the full composite key plus active on update", () => {
    expect(
      updateSubscriptionBodySchema.safeParse({
        active: false,
        channelId: "123",
        stateCode: "US-CA",
      }).success,
    ).toBe(false);
  });
});
