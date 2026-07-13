import { BadGatewayException, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { type CountiesResponse, countySchema } from "@scrubjay/api-contracts";
import { z } from "zod";
import type { AppConfig } from "@/core/config/config.schema";

/** County lists are effectively static; refresh daily at most. */
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

const upstreamSchema = z.array(countySchema);

@Injectable()
export class EBirdRegionsService {
  private readonly cache = new Map<
    string,
    { counties: CountiesResponse["counties"]; expiresAt: number }
  >();

  constructor(private readonly configService: ConfigService<AppConfig, true>) {}

  async countiesForState(stateCode: string): Promise<CountiesResponse> {
    const cached = this.cache.get(stateCode);
    if (cached) {
      if (cached.expiresAt > Date.now()) {
        return { counties: cached.counties };
      }
      // Drop the stale entry so expired states don't linger in the map.
      this.cache.delete(stateCode);
    }

    const url = new URL(
      `/v2/ref/region/list/subnational2/${encodeURIComponent(stateCode)}?fmt=json`,
      this.configService.get("EBIRD_BASE_URL", { infer: true }),
    );
    let response: Response;
    try {
      response = await fetch(url, {
        headers: {
          "X-eBirdApiToken": this.configService.get("EBIRD_TOKEN", {
            infer: true,
          }),
        },
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new BadGatewayException({
        code: "UPSTREAM",
        message: `eBird request failed for ${stateCode}`,
      });
    }
    if (!response.ok) {
      throw new BadGatewayException({
        code: "UPSTREAM",
        message: `eBird returned ${response.status} for ${stateCode}`,
      });
    }

    const parsed = upstreamSchema.safeParse(await response.json());
    if (!parsed.success) {
      throw new BadGatewayException({
        code: "UPSTREAM",
        message: "eBird returned an unexpected region payload",
      });
    }

    this.cache.set(stateCode, {
      counties: parsed.data,
      expiresAt: Date.now() + CACHE_TTL_MS,
    });
    return { counties: parsed.data };
  }
}
