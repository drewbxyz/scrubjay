import { Logger } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { registerMetricHarness } from "@/testing/otel-harness";
import { EBirdFetcher } from "./ebird.fetcher";
import type { EBirdObservation } from "./ebird.schema";
import { EBirdTransformer } from "./ebird.transformer";
import { IngestService } from "./ingest.service";
import type { Observation } from "./observation.interface";
import { ObservationRepository } from "./observation.repository";

const metricHarness = registerMetricHarness();

describe("IngestService", () => {
  let service: IngestService;

  const fetcherMock = {
    fetchRareObservations: vi.fn(),
  };

  const transformerMock = {
    transformObservations: vi.fn(),
  };

  const repoMock = {
    upsertObservations: vi.fn(),
  };

  const rawObservation: EBirdObservation = {
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

  const transformedObservation: Observation = {
    audioCount: 0,
    comName: "Common Loon",
    county: "King",
    countyCode: "US-WA-033",
    hasComments: false,
    howMany: 2,
    isPrivate: false,
    lat: 47.6062,
    lng: -122.3321,
    locationName: "Lake Union",
    locId: "loc-1",
    obsDt: new Date("2024-01-01T10:00:00Z"),
    obsReviewed: true,
    obsValid: true,
    photoCount: 1,
    presenceNoted: false,
    sciName: "Gavia immer",
    speciesCode: "comloo",
    state: "Washington",
    stateCode: "US-WA",
    subId: "sub-1",
    videoCount: 0,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        {
          provide: IngestService,
          useFactory: () =>
            new IngestService(
              fetcherMock as unknown as EBirdFetcher,
              transformerMock as unknown as EBirdTransformer,
              repoMock as unknown as ObservationRepository,
            ),
        },
      ],
    }).compile();

    service = module.get<IngestService>(IngestService);
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  afterAll(async () => {
    await metricHarness.shutdown();
  });

  it("does not count records when the fetch fails", async () => {
    fetcherMock.fetchRareObservations.mockRejectedValue(
      new Error("ebird down"),
    );

    await service.ingestRegion("US-WA");

    const records = await metricHarness.collect("scrubjay.ingest.records");
    expect(records).toBeUndefined();
  });

  it("counts ingested records per region", async () => {
    fetcherMock.fetchRareObservations.mockResolvedValue([rawObservation]);
    transformerMock.transformObservations.mockReturnValue([
      { some: "obs" },
      { some: "obs" },
    ] as unknown as Observation[]);
    repoMock.upsertObservations.mockResolvedValue(undefined);

    await service.ingestRegion("US-WA");

    const records = await metricHarness.collect("scrubjay.ingest.records");
    const point = records?.dataPoints.at(-1);
    expect(point?.value).toBe(2);
    expect(point?.attributes.region).toBe("US-WA");
  });

  it("returns zero and skips transform when fetching observations fails", async () => {
    fetcherMock.fetchRareObservations.mockRejectedValue(
      new Error("network failure"),
    );

    const inserted = await service.ingestRegion("US-WA");

    expect(inserted).toBe(0);
    expect(transformerMock.transformObservations).not.toHaveBeenCalled();
  });

  it("ingests transformed observations for a region", async () => {
    fetcherMock.fetchRareObservations.mockResolvedValue([rawObservation]);
    transformerMock.transformObservations.mockReturnValue([
      transformedObservation,
    ]);

    const inserted = await service.ingestRegion("US-WA");

    expect(fetcherMock.fetchRareObservations).toHaveBeenCalledWith("US-WA");
    expect(transformerMock.transformObservations).toHaveBeenCalledWith([
      rawObservation,
    ]);
    expect(repoMock.upsertObservations).toHaveBeenCalledWith([
      transformedObservation,
    ]);
    expect(inserted).toBe(1);
  });

  it("returns zero and logs when persisting the batch fails", async () => {
    const errorSpy = vi
      .spyOn(Logger.prototype, "error")
      .mockImplementation(() => {});
    fetcherMock.fetchRareObservations.mockResolvedValue([rawObservation]);
    transformerMock.transformObservations.mockReturnValue([
      transformedObservation,
    ]);
    repoMock.upsertObservations.mockRejectedValue(new Error("db down"));

    const inserted = await service.ingestRegion("US-WA");

    expect(inserted).toBe(0);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("US-WA"),
      expect.any(String),
    );
  });
});
