import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  HealthStateService,
  INGEST_STALE_AFTER_MS,
} from "./health-state.service";

describe("HealthStateService", () => {
  let service: HealthStateService;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-09T12:00:00Z"));
    service = new HealthStateService();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts with an empty snapshot", () => {
    expect(service.snapshot()).toEqual({
      dispatch: { lastTickAt: null },
      ingest: {
        lastTickAt: null,
        noSources: false,
        regions: {},
        sources: [],
      },
    });
  });

  it("records ingest ticks and per-region successes", () => {
    service.recordIngestTick(["US-CA", "US-WA"]);
    service.recordIngestSuccess("US-CA");

    const { ingest } = service.snapshot();
    expect(ingest.lastTickAt).toBe("2026-07-09T12:00:00.000Z");
    expect(ingest.sources).toEqual(["US-CA", "US-WA"]);
    expect(ingest.regions["US-CA"]).toEqual({
      lastSuccessAt: "2026-07-09T12:00:00.000Z",
      stale: false,
    });
    expect(ingest.regions["US-WA"]).toEqual({
      lastSuccessAt: null,
      stale: false,
    });
  });

  it("marks a region stale after INGEST_STALE_AFTER_MS without success", () => {
    service.recordIngestTick(["US-CA"]);
    service.recordIngestSuccess("US-CA");

    vi.advanceTimersByTime(INGEST_STALE_AFTER_MS + 1);

    expect(service.snapshot().ingest.regions["US-CA"]?.stale).toBe(true);
  });

  it("measures never-succeeded regions from boot, not epoch", () => {
    service.recordIngestTick(["US-NM"]);

    // Just under the threshold since construction: not yet stale.
    vi.advanceTimersByTime(INGEST_STALE_AFTER_MS - 1);
    expect(service.snapshot().ingest.regions["US-NM"]?.stale).toBe(false);

    // Past it: stale.
    vi.advanceTimersByTime(2);
    expect(service.snapshot().ingest.regions["US-NM"]?.stale).toBe(true);
  });

  it("flags noSources only after a tick reports an empty list", () => {
    expect(service.snapshot().ingest.noSources).toBe(false);

    service.recordIngestTick([]);
    expect(service.snapshot().ingest.noSources).toBe(true);

    service.recordIngestTick(["US-CA"]);
    expect(service.snapshot().ingest.noSources).toBe(false);
  });

  it("records dispatch ticks", () => {
    service.recordDispatchTick();
    expect(service.snapshot().dispatch.lastTickAt).toBe(
      "2026-07-09T12:00:00.000Z",
    );
  });
});
