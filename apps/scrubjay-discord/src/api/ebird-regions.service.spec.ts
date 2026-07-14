import { BadGatewayException } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "@/core/config/config.schema";
import { EBirdRegionsService } from "./ebird-regions.service";

const config = {
  get: (key: string) =>
    key === "EBIRD_BASE_URL" ? "https://api.ebird.org/" : "test-token",
} as unknown as ConfigService<AppConfig, true>;

afterEach(() => {
  vi.restoreAllMocks();
});

describe("EBirdRegionsService", () => {
  it("fetches, validates, and caches counties per state", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(
          JSON.stringify([{ code: "US-CA-085", name: "Santa Clara" }]),
        ),
      );
    const service = new EBirdRegionsService(config);
    const first = await service.countiesForState("US-CA");
    const second = await service.countiesForState("US-CA");
    expect(first.counties[0]?.name).toBe("Santa Clara");
    expect(second).toEqual(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = String(fetchMock.mock.calls[0]?.[0]);
    expect(url).toContain("/v2/ref/region/list/subnational2/US-CA");
  });

  it("maps upstream failures to BadGatewayException", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("nope", { status: 500 }),
    );
    await expect(
      new EBirdRegionsService(config).countiesForState("US-CA"),
    ).rejects.toThrow(BadGatewayException);
  });

  it("maps an unparseable 200 body to BadGatewayException", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("<html>not json</html>", { status: 200 }),
    );
    await expect(
      new EBirdRegionsService(config).countiesForState("US-CA"),
    ).rejects.toThrow(BadGatewayException);
  });

  it("maps a network/timeout failure to BadGatewayException", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("boom"));
    await expect(
      new EBirdRegionsService(config).countiesForState("US-CA"),
    ).rejects.toThrow(BadGatewayException);
  });

  it("evicts an expired entry when a later read finds it stale", async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(
          new Response(
            JSON.stringify([{ code: "US-CA-085", name: "Santa Clara" }]),
          ),
        );
      const service = new EBirdRegionsService(config);
      const { cache } = service as unknown as {
        cache: Map<string, unknown>;
      };

      await service.countiesForState("US-CA");
      expect(cache.has("US-CA")).toBe(true);

      // Age past the 24h TTL, then fail the refetch so nothing repopulates.
      vi.advanceTimersByTime(24 * 60 * 60 * 1000 + 1);
      fetchMock.mockRejectedValueOnce(new Error("boom"));
      await expect(service.countiesForState("US-CA")).rejects.toThrow(
        BadGatewayException,
      );

      expect(cache.has("US-CA")).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
