import { describe, expect, it } from "vitest";
import type { EBirdObservation } from "./ebird.schema";
import { EBirdTransformer } from "./ebird.transformer";

describe("EBirdTransformer", () => {
  const transformer = new EBirdTransformer();

  const baseObservation: EBirdObservation = {
    checklistId: "cl1",
    comName: "Common Loon",
    countryCode: "US",
    countryName: "United States",
    evidence: "P",
    firstName: "",
    hasComments: false,
    hasRichMedia: false,
    howMany: 2,
    lastName: "",
    lat: 47.6062,
    lng: -122.3321,
    locationPrivate: false,
    locId: "loc-1",
    locName: "Lake Union",
    obsDt: "2024-01-01T10:00:00Z",
    obsId: "obs-1",
    obsReviewed: true,
    obsValid: true,
    presenceNoted: false,
    sciName: "Gavia immer",
    speciesCode: "comloo",
    subId: "sub-1",
    subnational1Code: "US-WA",
    subnational1Name: "Washington",
    subnational2Code: "US-WA-033",
    subnational2Name: "King",
    userDisplayName: "",
  };

  it("aggregates duplicate observations and media counts", () => {
    const result = transformer.transformObservations([
      baseObservation,
      {
        ...baseObservation,
        evidence: "A",
        obsId: "obs-2",
        presenceNoted: true,
      },
      {
        ...baseObservation,
        evidence: "V",
        obsId: "obs-3",
        speciesCode: "mallar",
        subId: "sub-2",
      },
    ]);

    expect(result).toHaveLength(2);

    const first = result.find(
      (obs) => obs.speciesCode === "comloo" && obs.subId === "sub-1",
    );
    expect(first).toMatchObject({
      audioCount: 1,
      comName: "Common Loon",
      photoCount: 1,
      presenceNoted: true,
      videoCount: 0,
    });
  });

  it("translates eBird vocabulary into domain fields", () => {
    const [result] = transformer.transformObservations([baseObservation]);

    expect(result).toMatchObject({
      county: "King",
      countyCode: "US-WA-033",
      howMany: 2,
      isPrivate: false,
      locationName: "Lake Union",
      state: "Washington",
      stateCode: "US-WA",
    });
    expect(result.obsDt).toEqual(new Date("2024-01-01T10:00:00Z"));
    expect(result).not.toHaveProperty("subnational1Name");
    expect(result).not.toHaveProperty("evidence");
  });

  it("defaults howMany to zero when eBird omits it", () => {
    const [result] = transformer.transformObservations([
      { ...baseObservation, howMany: undefined },
    ]);

    expect(result.howMany).toBe(0);
  });
});
