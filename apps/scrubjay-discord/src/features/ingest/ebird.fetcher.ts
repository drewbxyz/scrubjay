import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { z } from "zod";
import type { AppConfig } from "@/core/config/config.schema";
import {
  type EBirdObservation,
  RawEBirdObservationSchema,
} from "./ebird.schema";

/** Abort an eBird request that has not responded within this window. */
const FETCH_TIMEOUT_MS = 10_000;

@Injectable()
export class EBirdFetcher {
  private readonly logger = new Logger(EBirdFetcher.name);

  constructor(private readonly configService: ConfigService<AppConfig, true>) {}

  /**
   * Fetches notable observations for a region. Returns validated
   * observations; throws on HTTP or network failure. Malformed rows are
   * logged and skipped rather than failing the batch.
   */
  async fetchRareObservations(regionCode: string): Promise<EBirdObservation[]> {
    const url = new URL(
      `/v2/data/obs/${encodeURIComponent(regionCode)}/recent/notable?back=7&detail=full`,
      this.configService.get("EBIRD_BASE_URL", { infer: true }),
    );

    // Fresh AbortController per request; clear the timer in `finally` so a
    // fast response releases it immediately (unlike AbortSignal.timeout()).
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(url, {
        headers: {
          "X-eBirdApiToken": this.configService.get("EBIRD_TOKEN", {
            infer: true,
          }),
        },
        signal: controller.signal,
      });
    } catch (err) {
      // fetch rejects with an AbortError on timeout; surface a clear message
      // instead of a bare "AbortError" in the logs.
      if (controller.signal.aborted) {
        throw new Error(
          `eBird request timed out after ${FETCH_TIMEOUT_MS}ms for ${regionCode}`,
        );
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      throw new Error(
        `eBird API returned ${response.status} ${response.statusText}`,
      );
    }

    const data: unknown = await response.json();
    if (!Array.isArray(data)) {
      throw new Error("eBird API returned a non-array payload");
    }

    const valid: EBirdObservation[] = [];
    let skipped = 0;
    for (const [index, row] of data.entries()) {
      const result = RawEBirdObservationSchema.safeParse(row);
      if (result.success) {
        valid.push(result.data);
      } else {
        skipped++;
        this.logger.warn(
          `Skipping malformed observation at index ${index}: ${z.prettifyError(result.error)}`,
        );
      }
    }

    this.logger.log(
      skipped > 0
        ? `Fetched ${valid.length} observations (${skipped} skipped)`
        : `Fetched ${valid.length} observations`,
    );
    return valid;
  }
}
