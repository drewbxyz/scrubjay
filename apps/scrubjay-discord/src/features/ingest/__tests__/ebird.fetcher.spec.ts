import { Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Test, type TestingModule } from "@nestjs/testing";
import { EBirdFetcher } from "../ebird.fetcher";
import type { EBirdObservation } from "../ebird.schema";

const validObservation: EBirdObservation = {
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

function mockFetchResponse(body: unknown, ok = true, status = 200) {
  global.fetch = jest.fn().mockResolvedValue({
    json: jest.fn().mockResolvedValue(body),
    ok,
    status,
    statusText: ok ? "OK" : "Internal Server Error",
  }) as unknown as typeof fetch;
}

describe("EBirdFetcher", () => {
  let fetcher: EBirdFetcher;
  let warnSpy: jest.SpyInstance;
  const originalFetch = global.fetch;
  const configServiceMock = {
    get: jest.fn(),
  } as unknown as ConfigService<never, true>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        {
          provide: EBirdFetcher,
          useFactory: () => new EBirdFetcher(configServiceMock),
        },
      ],
    }).compile();
    fetcher = module.get<EBirdFetcher>(EBirdFetcher);

    jest.clearAllMocks();
    warnSpy = jest.spyOn(Logger.prototype, "warn").mockImplementation();
    jest.spyOn(Logger.prototype, "log").mockImplementation();

    (configServiceMock.get as unknown as jest.Mock).mockImplementation(
      (key: string) => {
        if (key === "EBIRD_BASE_URL") return "https://api.ebird.org";
        if (key === "EBIRD_TOKEN") return "token";
        throw new Error("unexpected key");
      },
    );
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it("sends a request with configured base URL and token and returns validated rows", async () => {
    mockFetchResponse([validObservation]);

    const result = await fetcher.fetchRareObservations("US-WA");

    const [url, options] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url.toString()).toBe(
      "https://api.ebird.org/v2/data/obs/US-WA/recent/notable?back=7&detail=full",
    );
    expect(options).toMatchObject({
      headers: { "X-eBirdApiToken": "token" },
    });
    expect(result).toEqual([validObservation]);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("throws with status and statusText when the request fails", async () => {
    mockFetchResponse(null, false, 500);

    await expect(fetcher.fetchRareObservations("US-CA")).rejects.toThrow(
      "eBird API returned 500 Internal Server Error",
    );
  });

  it("throws when the payload is not an array", async () => {
    mockFetchResponse({ error: "quota exceeded" });

    await expect(fetcher.fetchRareObservations("US-CA")).rejects.toThrow(
      "eBird API returned a non-array payload",
    );
  });

  it("skips malformed rows, logs them, and returns the valid ones", async () => {
    const malformed = { ...validObservation, lat: "not-a-number" };
    mockFetchResponse([validObservation, malformed]);

    const result = await fetcher.fetchRareObservations("US-WA");

    expect(result).toEqual([validObservation]);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Skipping malformed observation at index 1"),
    );
  });
});
