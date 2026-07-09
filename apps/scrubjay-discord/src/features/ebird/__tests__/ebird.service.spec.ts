import { Test, type TestingModule } from "@nestjs/testing";
import { EBirdFetcher } from "../ebird.fetcher";
import { EBirdRepository } from "../ebird.repository";
import type {
  EBirdObservation,
  TransformedEBirdObservation,
} from "../ebird.schema";
import { EBirdService } from "../ebird.service";
import { EBirdTransformer } from "../ebird.transformer";

describe("EBirdService", () => {
  let service: EBirdService;

  const fetcherMock = {
    fetchRareObservations: jest.fn(),
  };

  const transformerMock = {
    transformObservations: jest.fn(),
  };

  const repoMock = {
    getAlertsCreatedSinceDate: jest.fn(),
    upsertLocation: jest.fn(),
    upsertObservation: jest.fn(),
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

  const transformedObservation: TransformedEBirdObservation = {
    ...rawObservation,
    audioCount: 0,
    photoCount: 1,
    videoCount: 0,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        {
          provide: EBirdService,
          useFactory: () =>
            new EBirdService(
              fetcherMock as unknown as EBirdFetcher,
              transformerMock as unknown as EBirdTransformer,
              repoMock as unknown as EBirdRepository,
            ),
        },
      ],
    }).compile();

    service = module.get<EBirdService>(EBirdService);
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.resetAllMocks();
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
    const ingestSpy = jest
      .spyOn(service, "ingestObservation")
      .mockResolvedValue();

    const inserted = await service.ingestRegion("US-WA");

    expect(fetcherMock.fetchRareObservations).toHaveBeenCalledWith("US-WA");
    expect(transformerMock.transformObservations).toHaveBeenCalledWith([
      rawObservation,
    ]);
    expect(ingestSpy).toHaveBeenCalledTimes(1);
    expect(ingestSpy).toHaveBeenCalledWith(transformedObservation);
    expect(inserted).toBe(1);
  });

  it("writes a single observation to both location and observation tables", async () => {
    await service.ingestObservation(transformedObservation);

    expect(repoMock.upsertLocation).toHaveBeenCalledWith(
      transformedObservation,
    );
    expect(repoMock.upsertObservation).toHaveBeenCalledWith(
      transformedObservation,
    );
  });
});
