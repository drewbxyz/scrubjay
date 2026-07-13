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

  it("maps a network/timeout failure to BadGatewayException", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("boom"));
    await expect(
      new EBirdRegionsService(config).countiesForState("US-CA"),
    ).rejects.toThrow(BadGatewayException);
  });
});
