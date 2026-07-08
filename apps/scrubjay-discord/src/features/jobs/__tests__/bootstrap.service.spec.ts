import { Logger } from "@nestjs/common";
import type { AlertQueue } from "@/features/dispatch/alert-queue";
import type { EBirdService } from "@/features/ebird/ebird.service";
import type { SourcesService } from "@/features/sources/sources.service";
import { BootstrapService } from "../bootstrap.service";

describe("BootstrapService", () => {
  let service: BootstrapService;

  const ebirdServiceMock = { ingestRegion: jest.fn() };
  const alertQueueMock = { markSent: jest.fn(), pendingEBirdAlerts: jest.fn() };
  const sourcesMock = { getEBirdSources: jest.fn() };

  beforeEach(() => {
    jest.spyOn(Logger.prototype, "error").mockImplementation();
    jest.spyOn(Logger.prototype, "warn").mockImplementation();
    jest.spyOn(Logger.prototype, "log").mockImplementation();

    ebirdServiceMock.ingestRegion.mockResolvedValue(3);
    sourcesMock.getEBirdSources.mockResolvedValue(["US-CA"]);
    alertQueueMock.pendingEBirdAlerts.mockResolvedValue([]);
    alertQueueMock.markSent.mockResolvedValue(undefined);

    service = new BootstrapService(
      ebirdServiceMock as unknown as EBirdService,
      alertQueueMock as unknown as AlertQueue,
      sourcesMock as unknown as SourcesService,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
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
    jest.useFakeTimers();
    const wait = service.waitForBootstrap();
    const assertion = expect(wait).rejects.toThrow(
      "Bootstrap timed out after 5 minutes",
    );
    jest.advanceTimersByTime(5 * 60 * 1000);
    await assertion;
  });

  it("rejects waitForBootstrap with a descriptive timeout error (B7)", async () => {
    jest.useFakeTimers();

    const wait = service.waitForBootstrap();
    const assertion = expect(wait).rejects.toThrow(
      "Bootstrap timed out after 5 minutes",
    );
    jest.advanceTimersByTime(5 * 60 * 1000);

    await assertion;
  });
});
