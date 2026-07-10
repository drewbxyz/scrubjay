import { Injectable } from "@nestjs/common";

// Three missed ticks of the 15-minute ingest cron. (Not a doc comment: the
// cron literal "*/15" would terminate a block comment early.)
export const INGEST_STALE_AFTER_MS = 45 * 60 * 1000;

export interface RegionHealth {
  lastSuccessAt: string | null;
  stale: boolean;
}

export interface HealthSnapshot {
  dispatch: { lastTickAt: string | null };
  ingest: {
    lastTickAt: string | null;
    noSources: boolean;
    regions: Record<string, RegionHealth>;
    sources: string[];
  };
}

/**
 * In-memory freshness state written by the cron jobs and read by the health
 * indicators. Deliberately not persisted: single process, informational-only,
 * reconstructible within one ingest tick (spec decision 3).
 */
@Injectable()
export class HealthStateService {
  // Never-succeeded regions measure staleness from boot so a fresh restart
  // doesn't report every region stale until the first tick (spec §2).
  private readonly bootedAt = Date.now();
  private lastDispatchTickAt: Date | null = null;
  private lastIngestTickAt: Date | null = null;
  private sources: string[] = [];
  private readonly successes = new Map<string, Date>();

  recordDispatchTick(): void {
    this.lastDispatchTickAt = new Date();
  }

  recordIngestSuccess(region: string): void {
    this.successes.set(region, new Date());
  }

  recordIngestTick(regions: string[]): void {
    this.lastIngestTickAt = new Date();
    this.sources = [...regions];
  }

  snapshot(): HealthSnapshot {
    const now = Date.now();
    const regions: Record<string, RegionHealth> = {};
    for (const region of this.sources) {
      const lastSuccess = this.successes.get(region) ?? null;
      const staleClockStart = lastSuccess?.getTime() ?? this.bootedAt;
      regions[region] = {
        lastSuccessAt: lastSuccess?.toISOString() ?? null,
        stale: now - staleClockStart > INGEST_STALE_AFTER_MS,
      };
    }
    return {
      dispatch: {
        lastTickAt: this.lastDispatchTickAt?.toISOString() ?? null,
      },
      ingest: {
        lastTickAt: this.lastIngestTickAt?.toISOString() ?? null,
        noSources: this.lastIngestTickAt !== null && this.sources.length === 0,
        regions,
        sources: [...this.sources],
      },
    };
  }
}
