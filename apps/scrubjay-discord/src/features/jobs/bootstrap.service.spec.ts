import { Logger } from "@nestjs/common";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AlertQueue } from "@/features/dispatch/alert-queue.service";
import type { IngestService } from "@/features/ingest/ingest.service";
import type { SourcesRepository } from "@/features/sources/sources.repository";
import { BootstrapService } from "./bootstrap.service";

describe("BootstrapService", () => {
  let service: BootstrapService;

  const ebirdServiceMock = { ingestRegion: vi.fn() };
  const alertQueueMock = { markSent: vi.fn(), pendingEBirdAlerts: vi.fn() };
  const sourcesMock = { getEBirdSources: vi.fn() };

  beforeEach(() => {
    vi.spyOn(Logger.prototype, "error").mockImplementation(() => {});
    vi.spyOn(Logger.prototype, "warn").mockImplementation(() => {});
    vi.spyOn(Logger.prototype, "log").mockImplementation(() => {});

    ebirdServiceMock.ingestRegion.mockResolvedValue(3);
    sourcesMock.getEBirdSources.mockResolvedValue(["US-CA"]);
    alertQueueMock.pendingEBirdAlerts.mockResolvedValue([]);
    alertQueueMock.markSent.mockResolvedValue(undefined);

    service = new BootstrapService(
      ebirdServiceMock as unknown as IngestService,
      alertQueueMock as unknown as AlertQueue,
      sourcesMock as unknown as SourcesRepository,
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("unblocks jobs after a successful bootstrap", async () => {
    await service.onModuleInit();

    await expect(service.waitForBootstrap()).resolves.toBeUndefined();
  });

  it("tolerates per-region ingest failures", async () => {
    sourcesMock.getEBirdSources.mockResolvedValue(["US-CA", "US-WA"]);
    ebirdServiceMock.ingestRegion.mockRejectedValueOnce(new Error("eBird 500"));

    await service.onModuleInit();

    await expect(service.waitForBootstrap()).resolves.toBeUndefined();
  });

  it("does not unblock jobs when markSent fails (B6)", async () => {
    alertQueueMock.markSent.mockRejectedValue(new Error("db down"));

    await expect(service.onModuleInit()).rejects.toThrow("db down");

    // The flag must not be set — a failed bootstrap must not unblock dispatch.
    vi.useFakeTimers();
    const wait = service.waitForBootstrap();
    const assertion = expect(wait).rejects.toThrow(
      "Bootstrap timed out after 5 minutes",
    );
    vi.advanceTimersByTime(5 * 60 * 1000);
    await assertion;
  });

  it("rejects waitForBootstrap with a descriptive timeout error (B7)", async () => {
    vi.useFakeTimers();

    const wait = service.waitForBootstrap();
    const assertion = expect(wait).rejects.toThrow(
      "Bootstrap timed out after 5 minutes",
    );
    vi.advanceTimersByTime(5 * 60 * 1000);

    await assertion;
  });
});
