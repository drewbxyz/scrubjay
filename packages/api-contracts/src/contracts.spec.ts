import { describe, expect, it } from "vitest";
import { pendingAlertSchema } from "./alerts.js";
import { listDeliveriesQuerySchema } from "./deliveries.js";
import { stateCodeSchema } from "./ebird.js";
import { addFilterBodySchema, deleteFilterQuerySchema } from "./filters.js";
import { guildsResponseSchema } from "./guilds.js";
import { listObservationsQuerySchema } from "./observations.js";
import { regionsResponseSchema } from "./regions.js";

describe("api contracts", () => {
  it("trims and requires a non-empty filter common name", () => {
    expect(addFilterBodySchema.parse({ commonName: " Verdin " })).toEqual({
      commonName: "Verdin",
    });
    expect(addFilterBodySchema.safeParse({ commonName: "  " }).success).toBe(
      false,
    );
  });

  it("preserves edge whitespace on the delete query so stored names stay deletable", () => {
    expect(deleteFilterQuerySchema.parse({ commonName: " Verdin " })).toEqual({
      commonName: " Verdin ",
    });
    expect(deleteFilterQuerySchema.safeParse({ commonName: "" }).success).toBe(
      false,
    );
  });

  it("parses a guilds response", () => {
    const parsed = guildsResponseSchema.parse({
      guilds: [
        { channels: [{ id: "2", name: "birds" }], id: "1", name: "Guild" },
      ],
    });
    expect(parsed.guilds[0]?.channels[0]?.name).toBe("birds");
  });

  it("applies pagination defaults to observation queries", () => {
    const parsed = listObservationsQuerySchema.parse({});
    expect(parsed.limit).toBe(50);
    expect(parsed.offset).toBe(0);
  });

  it("rejects an unknown delivery status filter", () => {
    expect(
      listDeliveriesQuerySchema.safeParse({ status: "lost" }).success,
    ).toBe(false);
  });

  it("parses a pending alert with ISO dates", () => {
    const parsed = pendingAlertSchema.parse({
      audioCount: 0,
      channelId: "CH1",
      comName: "Vermilion Flycatcher",
      county: "Santa Clara",
      createdAt: "2026-07-13T00:00:00.000Z",
      howMany: 1,
      isPrivate: false,
      locationName: "Test Hotspot",
      locId: "L001",
      obsDt: "2026-07-13T00:00:00.000Z",
      photoCount: 0,
      recentlyConfirmed: false,
      sciName: "Pyrocephalus rubinus",
      speciesCode: "verfly",
      state: "California",
      subId: "S001",
      videoCount: 0,
    });
    expect(parsed.speciesCode).toBe("verfly");
  });

  it("accepts state codes like US-CA and rejects bare countries", () => {
    expect(stateCodeSchema.safeParse("US-CA").success).toBe(true);
    expect(stateCodeSchema.safeParse("US").success).toBe(false);
  });

  it("rejects a state code with an over-long suffix", () => {
    expect(stateCodeSchema.safeParse("US-ABCDEFGHIJK").success).toBe(false);
  });

  it("groups subscriptions under regions", () => {
    const parsed = regionsResponseSchema.parse({
      regions: [
        {
          stateCode: "US-CA",
          subscriptions: [
            {
              active: true,
              channelId: "CH1",
              countyCode: "*",
              lastUpdated: "2026-07-13T00:00:00.000Z",
              stateCode: "US-CA",
            },
          ],
        },
      ],
    });
    expect(parsed.regions[0]?.stateCode).toBe("US-CA");
  });
});
