import { Logger } from "@nestjs/common";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RetentionRepository } from "./retention.repository";
import {
  DELIVERY_RETENTION_DAYS,
  OBSERVATION_RETENTION_DAYS,
  RetentionService,
} from "./retention.service";

const DAY_MS = 24 * 60 * 60 * 1000;

describe("RetentionService", () => {
  let service: RetentionService;
  const calls: string[] = [];

  const repositoryMock = {
    pruneDeliveries: vi.fn(async () => {
      calls.push("deliveries");
      return 2;
    }),
    pruneObservations: vi.fn(async () => {
      calls.push("observations");
      return 3;
    }),
    pruneOrphanLocations: vi.fn(async () => {
      calls.push("locations");
      return 1;
    }),
  };

  beforeEach(() => {
    vi.spyOn(Logger.prototype, "log").mockImplementation(() => {});
    calls.length = 0;
    repositoryMock.pruneDeliveries.mockClear();
    repositoryMock.pruneObservations.mockClear();
    repositoryMock.pruneOrphanLocations.mockClear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-10T04:17:00Z"));
    service = new RetentionService(
      repositoryMock as unknown as RetentionRepository,
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("prunes observations before orphan locations", async () => {
    await service.prune();

    expect(calls).toEqual(["observations", "deliveries", "locations"]);
  });

  it("passes each table its retention cutoff", async () => {
    await service.prune();

    expect(repositoryMock.pruneObservations).toHaveBeenCalledWith(
      new Date(Date.now() - OBSERVATION_RETENTION_DAYS * DAY_MS),
    );
    expect(repositoryMock.pruneDeliveries).toHaveBeenCalledWith(
      new Date(Date.now() - DELIVERY_RETENTION_DAYS * DAY_MS),
    );
  });

  it("logs a count per table", async () => {
    const logSpy = vi.spyOn(Logger.prototype, "log");

    await service.prune();

    const logged = logSpy.mock.calls.map((call) => String(call[0]));
    expect(logged.some((line) => line.includes("3 observation"))).toBe(true);
    expect(logged.some((line) => line.includes("2 deliver"))).toBe(true);
    expect(logged.some((line) => line.includes("1 orphaned location"))).toBe(
      true,
    );
  });
});
