import { ConfigService } from "@nestjs/config";
import { Test, type TestingModule } from "@nestjs/testing";
import { EBirdFetcher } from "../ebird.fetcher";

describe("EBirdFetcher", () => {
  let fetcher: EBirdFetcher;
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

    (configServiceMock.get as unknown as jest.Mock).mockImplementation(
      (key: string) => {
        if (key === "EBIRD_BASE_URL") return "https://api.ebird.org";
        if (key === "EBIRD_TOKEN") return "token";
        throw new Error("unexpected key");
      },
    );

    jest.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("sends a request with configured base URL and token", async () => {
    const responseData = [{ obsId: "1" }];
    global.fetch = jest.fn().mockResolvedValue({
      json: jest.fn().mockResolvedValue(responseData),
      ok: true,
      statusText: "OK",
    }) as unknown as typeof fetch;

    const result = await fetcher.fetchRareObservations("US-WA");

    const [url, options] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url.toString()).toBe(
      "https://api.ebird.org/v2/data/obs/US-WA/recent/notable?back=7&detail=full",
    );
    expect(options).toMatchObject({
      headers: { "X-eBirdApiToken": "token" },
    });
    expect(result).toEqual(responseData);
  });

  it("returns an empty array when the request fails", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      json: jest.fn(),
      ok: false,
      statusText: "Oops",
    }) as unknown as typeof fetch;

    const result = await fetcher.fetchRareObservations("US-CA");

    expect(result).toEqual([]);
  });
});
