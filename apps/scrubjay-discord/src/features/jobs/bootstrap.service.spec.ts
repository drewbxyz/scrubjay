import { Logger } from "@nestjs/common";
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { AlertQueue } from "@/features/dispatch/alert-queue.service";
import type { IngestService } from "@/features/ingest/ingest.service";
import type { SourcesRepository } from "@/features/sources/sources.repository";
import { registerMetricHarness } from "@/testing/otel-harness";
import { BootstrapService } from "./bootstrap.service";

const metricHarness = registerMetricHarness();

describe("BootstrapService", () => {
  let service: BootstrapService;

  const ebirdServiceMock = { ingestRegion: vi.fn() };
  const alertQueueMock = { pendingEBirdAlerts: vi.fn(), record: vi.fn() };
  const sourcesMock = { getEBirdSources: vi.fn() };

  beforeEach(() => {
    vi.spyOn(Logger.prototype, "error").mockImplementation(() => {});
    vi.spyOn(Logger.prototype, "warn").mockImplementation(() => {});
    vi.spyOn(Logger.prototype, "log").mockImplementation(() => {});

    ebirdServiceMock.ingestRegion.mockResolvedValue(3);
    sourcesMock.getEBirdSources.mockResolvedValue(["US-CA"]);
    alertQueueMock.pendingEBirdAlerts.mockResolvedValue([]);
    alertQueueMock.record.mockResolvedValue(undefined);

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

  afterAll(async () => {
    await metricHarness.shutdown();
  });

  it("unblocks jobs after a successful bootstrap", async () => {
    await service.onModuleInit();

    await expect(service.waitForBootstrap()).resolves.toBeUndefined();
    expect(alertQueueMock.record).toHaveBeenCalledWith([], "suppressed");
  });

  it("tolerates per-region ingest failures", async () => {
    sourcesMock.getEBirdSources.mockResolvedValue(["US-CA", "US-WA"]);
    ebirdServiceMock.ingestRegion.mockRejectedValueOnce(new Error("eBird 500"));

    await service.onModuleInit();

    await expect(service.waitForBootstrap()).resolves.toBeUndefined();
  });

  it("does not unblock jobs when record fails (B6)", async () => {
    alertQueueMock.record.mockRejectedValue(new Error("db down"));

    await expect(service.onModuleInit()).rejects.toThrow("db down");

    // A failed bootstrap must not unblock dispatch: waitForBootstrap returns
    // the same rejected promise, surfacing the real error rather than resolving.
    await expect(service.waitForBootstrap()).rejects.toThrow("db down");
  });

  it("kicks off bootstrap when waited on before onModuleInit", async () => {
    const first = service.waitForBootstrap();

    // The same in-flight promise is reused, not a fresh bootstrap per call.
    expect(service.waitForBootstrap()).toBe(first);
    expect(service.onModuleInit()).toBe(first);
    await expect(first).resolves.toBeUndefined();
  });

  it("counts suppressed pre-existing alerts", async () => {
    sourcesMock.getEBirdSources.mockResolvedValue([]); // skip ingest loop
    alertQueueMock.pendingEBirdAlerts.mockResolvedValue([
      { channelId: "CH1", speciesCode: "verfly", subId: "S1" },
      { channelId: "CH1", speciesCode: "verfly", subId: "S2" },
    ]);
    alertQueueMock.record.mockResolvedValue(undefined);

    await service.onModuleInit();

    const metric = await metricHarness.collect("scrubjay.dispatch.alerts");
    const point = metric?.dataPoints.find(
      (p) => p.attributes.status === "suppressed",
    );
    expect(point?.value).toBe(2);
  });
});
