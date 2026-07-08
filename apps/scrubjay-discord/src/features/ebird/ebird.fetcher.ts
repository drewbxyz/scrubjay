import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { AppConfig } from "@/core/config/config.schema";
import type { EBirdObservation } from "./ebird.schema";

@Injectable()
export class EBirdFetcher {
  private readonly logger = new Logger(EBirdFetcher.name);

  constructor(private readonly configService: ConfigService<AppConfig, true>) {}

  /**
   * Fetches notable observations for a specified region code
   */
  async fetchRareObservations(regionCode: string): Promise<EBirdObservation[]> {
    const url = new URL(
      `/v2/data/obs/${regionCode}/recent/notable?back=7&detail=full`,
      this.configService.get("EBIRD_BASE_URL", { infer: true }),
    );

    const response = await fetch(url, {
      headers: {
        "X-eBirdApiToken": this.configService.get("EBIRD_TOKEN", {
          infer: true,
        }),
      },
    });
    if (!response.ok) {
      this.logger.warn(`Failed to fetch observations: ${response.statusText}`);
      return [];
    }
    const data = await response.json();
    this.logger.log(`Fetched ${data.length} observations`);
    return data;
  }
}
