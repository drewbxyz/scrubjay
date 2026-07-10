import { Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Test, type TestingModule } from "@nestjs/testing";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type Mock,
  type MockInstance,
  vi,
} from "vitest";
import { EBirdFetcher } from "./ebird.fetcher";
import type { EBirdObservation } from "./ebird.schema";

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
  global.fetch = vi.fn().mockResolvedValue({
    json: vi.fn().mockResolvedValue(body),
    ok,
    status,
    statusText: ok ? "OK" : "Internal Server Error",
  }) as unknown as typeof fetch;
}

describe("EBirdFetcher", () => {
  let fetcher: EBirdFetcher;
  let warnSpy: MockInstance;
  const originalFetch = global.fetch;
  const configServiceMock = {
    get: vi.fn(),
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

    vi.clearAllMocks();
    warnSpy = vi.spyOn(Logger.prototype, "warn").mockImplementation(() => {});
    vi.spyOn(Logger.prototype, "log").mockImplementation(() => {});

    (configServiceMock.get as unknown as Mock).mockImplementation(
      (key: string) => {
        if (key === "EBIRD_BASE_URL") return "https://api.ebird.org";
        if (key === "EBIRD_TOKEN") return "token";
        throw new Error("unexpected key");
      },
    );
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("sends a request with configured base URL and token and returns validated rows", async () => {
    mockFetchResponse([validObservation]);

    const result = await fetcher.fetchRareObservations("US-WA");

    const [url, options] = (global.fetch as Mock).mock.calls[0];
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

  it("skips rows with a fractional howMany", async () => {
    const fractional = { ...validObservation, howMany: 2.5 };
    mockFetchResponse([validObservation, fractional]);

    const result = await fetcher.fetchRareObservations("US-WA");

    expect(result).toEqual([validObservation]);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Skipping malformed observation at index 1"),
    );
  });

  it("skips rows whose obsDt cannot be parsed as a date", async () => {
    const badDate = { ...validObservation, obsDt: "not-a-date" };
    mockFetchResponse([validObservation, badDate]);

    const result = await fetcher.fetchRareObservations("US-WA");

    expect(result).toEqual([validObservation]);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Skipping malformed observation at index 1"),
    );
  });

  it("skips rows whose howMany exceeds the int4 range", async () => {
    const tooLarge = { ...validObservation, howMany: 2_147_483_648 };
    mockFetchResponse([validObservation, tooLarge]);

    const result = await fetcher.fetchRareObservations("US-WA");

    expect(result).toEqual([validObservation]);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Skipping malformed observation at index 1"),
    );
  });

  it("skips rows with a negative howMany", async () => {
    const negative = { ...validObservation, howMany: -1 };
    mockFetchResponse([validObservation, negative]);

    const result = await fetcher.fetchRareObservations("US-WA");

    expect(result).toEqual([validObservation]);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Skipping malformed observation at index 1"),
    );
  });

  it("accepts eBird's native space-separated obsDt format", async () => {
    const native = { ...validObservation, obsDt: "2020-01-21 16:35" };
    mockFetchResponse([native]);

    const result = await fetcher.fetchRareObservations("US-WA");

    expect(result).toEqual([native]);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("rejects with a clear timeout message when the request hangs", async () => {
    vi.useFakeTimers();
    try {
      // A never-resolving fetch that rejects only once its signal aborts,
      // mirroring how the real fetch reacts to AbortController.abort().
      global.fetch = vi.fn(
        (_url: unknown, options: { signal: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            options.signal.addEventListener("abort", () => {
              const abortError = new Error("The operation was aborted");
              abortError.name = "AbortError";
              reject(abortError);
            });
          }),
      ) as unknown as typeof fetch;

      const pending = fetcher.fetchRareObservations("US-WA");
      const assertion = expect(pending).rejects.toThrow(
        "eBird request timed out after 10000ms for US-WA",
      );

      await vi.advanceTimersByTimeAsync(10_000);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it("clears the timeout timer on a fast successful response", async () => {
    vi.useFakeTimers();
    try {
      const clearTimeoutSpy = vi.spyOn(global, "clearTimeout");
      mockFetchResponse([validObservation]);

      const result = await fetcher.fetchRareObservations("US-WA");

      expect(result).toEqual([validObservation]);
      expect(clearTimeoutSpy).toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
