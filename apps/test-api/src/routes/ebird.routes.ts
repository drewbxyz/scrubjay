import express from "express";
import moment from "moment-timezone";
import { hotspots } from "../data/hotspots.ts";
import { regions } from "../data/regions.ts";
import { species } from "../data/species.ts";

export interface eBirdObservation {
  speciesCode: string;
  comName: string;
  sciName: string;
  locId: string;
  locName: string;
  obsDt: string;
  howMany: number;
  lat: number;
  lng: number;
  obsValid: boolean;
  obsReviewed: boolean;
  locationPrivate: boolean;
  subId: string;
  countryCode: string;
  countryName: string;
  subnational1Code: string;
  subnational1Name: string;
  subnational2Code: string;
  subnational2Name: string;
  firstName: string;
  lastName: string;
  userDisplayName: string;
  obsId: string;
  checklistId: string;
  presenceNoted: boolean;
  hasRichMedia: boolean;
  hasComments: boolean;
  evidence: "P" | "A" | "V" | null;
  exoticsCategory: string | null;
  isChecklistReviewed: boolean;
}

// Pool of existing locations for reuse
const locationPool: Record<
  string,
  { locId: string; locName: string; lat: number; lng: number }[]
> = {};

// Initialize location pools from hotspots data
Object.keys(hotspots).forEach((regionCode) => {
  const regionHotspots = hotspots[regionCode as keyof typeof hotspots];
  if (regionHotspots) {
    locationPool[regionCode] = regionHotspots.map((hotspot) => ({
      lat: hotspot.lat,
      lng: hotspot.lng,
      locId: hotspot.locId,
      locName: hotspot.locName,
    }));
  }
});

function generateRandomObservation(
  regionCode: string,
  hotspot?: { locId: string; locName: string; lat: number; lng: number },
  daysBack: number = 7,
): eBirdObservation {
  const region = regions[regionCode as keyof typeof regions];
  const randomSpecies = species[Math.floor(Math.random() * species.length)];
  const randomSubregion = Object.keys(region.counties)[
    Math.floor(Math.random() * Object.keys(region.counties).length)
  ];

  if (!randomSpecies || !randomSubregion) {
    throw new Error("Unable to generate observation data");
  }

  let hotspotData: { locId: string; locName: string; lat: number; lng: number };

  if (hotspot) {
    hotspotData = hotspot;
  } else {
    const shouldReuseLocation = Math.random() < 0.8;
    const availableLocations = locationPool[regionCode] || [];

    if (shouldReuseLocation && availableLocations.length > 0) {
      const randomLocation =
        availableLocations[
          Math.floor(Math.random() * availableLocations.length)
        ];
      // biome-ignore lint/style/noNonNullAssertion: We know it exists because we checked length > 0
      hotspotData = randomLocation!;
    } else {
      hotspotData = {
        lat: 37.7749 + (Math.random() - 0.5) * 0.1,
        lng: -122.4194 + (Math.random() - 0.5) * 0.1,
        locId: crypto.randomUUID(),
        locName: `Random Location ${Math.floor(Math.random() * 1000)}`,
      };

      if (!locationPool[regionCode]) {
        locationPool[regionCode] = [];
      }
      locationPool[regionCode].push(hotspotData);
    }
  }

  const obsDt = moment()
    .subtract(Math.floor(Math.random() * daysBack), "days")
    .format("YYYY-MM-DD HH:mm:ss");

  return {
    checklistId: crypto.randomUUID(),
    comName: randomSpecies.comName,
    countryCode: "US",
    countryName: "United States",
    evidence:
      Math.random() > 0.9
        ? (["P", "A", "V"][Math.floor(Math.random() * 3)] as "P" | "A" | "V")
        : null,
    exoticsCategory: null,
    firstName: "John",
    hasComments: Math.random() > 0.7,
    hasRichMedia: Math.random() > 0.8,
    howMany: Math.floor(Math.random() * 10) + 1,
    isChecklistReviewed: Math.random() > 0.2,
    lastName: "Doe",
    lat: hotspotData.lat,
    lng: hotspotData.lng,
    locationPrivate: false,
    locId: hotspotData.locId,
    locName: hotspotData.locName,
    obsDt,
    obsId: crypto.randomUUID(),
    obsReviewed: Math.random() > 0.3,
    obsValid: true,
    presenceNoted: true,
    sciName: randomSpecies.sciName,
    speciesCode: randomSpecies.speciesCode,
    subId: crypto.randomUUID(),
    subnational1Code: region.code,
    subnational1Name: region.name,
    subnational2Code:
      region.counties[randomSubregion as keyof typeof region.counties],
    subnational2Name: randomSubregion,
    userDisplayName: "John Doe",
  };
}

export function createEbirdRoutes() {
  const router = express.Router();

  // In-memory storage for observations
  const notableObservations: Record<string, eBirdObservation[]> = {};

  // Notable observations in a region
  router.get("/data/obs/:regionCode/recent/notable", (req, res) => {
    const { regionCode } = req.params;
    const {
      maxResults = "50",
      includeProvisional = "false",
      hotspot = "false",
      back = "7",
    } = req.query;

    if (!regionCode) {
      return res.status(400).json({ error: "Region code is required" });
    }

    const region = regions[regionCode as keyof typeof regions];
    if (!region) {
      return res.status(404).json({ error: "Region not found" });
    }

    const maxResultsNum = Math.min(
      parseInt(maxResults as string, 10) || 50,
      10000,
    );
    const includeProv = includeProvisional === "true";
    const hotspotOnly = hotspot === "true";
    const daysBack = parseInt(back as string, 10) || 7;

    // Filter existing observations to only include those within the time window
    const cutoffDate = moment().subtract(daysBack, "days");
    const existingNotable = (notableObservations[regionCode] || []).filter(
      (obs) => moment(obs.obsDt).isAfter(cutoffDate),
    );

    const newNotableObservations: eBirdObservation[] = [];

    // Generate more observations (up to 10, or maxResultsNum if less)
    const numToGenerate = Math.min(maxResultsNum, 10);
    for (let i = 0; i < numToGenerate; i++) {
      const hotspotData =
        hotspotOnly && hotspots[regionCode]
          ? hotspots[regionCode][
              Math.floor(Math.random() * hotspots[regionCode].length)
            ]
          : undefined;

      const obs = generateRandomObservation(regionCode, hotspotData, daysBack);
      obs.obsReviewed = true;
      obs.evidence =
        Math.random() > 0.5
          ? (["P", "A", "V"][Math.floor(Math.random() * 3)] as "P" | "A" | "V")
          : null;

      if (includeProv || obs.obsReviewed) {
        newNotableObservations.push(obs);
      }
    }

    notableObservations[regionCode] = [
      ...existingNotable,
      ...newNotableObservations,
    ].slice(-maxResultsNum);

    res.json(notableObservations[regionCode]);
  });

  return router;
}
