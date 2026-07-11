import { Logger } from "@nestjs/common";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type MockInstance,
  vi,
} from "vitest";
import type { HealthStateService } from "@/features/health/health-state.service";
import type { IngestService } from "@/features/ingest/ingest.service";
import type { SourcesRepository } from "@/features/sources/sources.repository";
import { JobTelemetry } from "@/telemetry/job-telemetry.service";
import type { BootstrapService } from "./bootstrap.service";
import { IngestJob } from "./ingest.job";

describe("IngestJob", () => {
  let job: IngestJob;
  let loggerErrorSpy: MockInstance;

  const ebirdMock = { ingestRegion: vi.fn() };
  const bootstrapMock = { waitForBootstrap: vi.fn() };
  const sourcesMock = { getEBirdSources: vi.fn() };
  const healthStateMock = {
    recordIngestSuccess: vi.fn(),
    recordIngestTick: vi.fn(),
  };
  let loggerWarnSpy: MockInstance;

  beforeEach(() => {
    loggerErrorSpy = vi
      .spyOn(Logger.prototype, "error")
      .mockImplementation(() => {});
    loggerWarnSpy = vi
      .spyOn(Logger.prototype, "warn")
      .mockImplementation(() => {});
    vi.spyOn(Logger.prototype, "debug").mockImplementation(() => {});
    vi.spyOn(Logger.prototype, "log").mockImplementation(() => {});

    ebirdMock.ingestRegion.mockReset();
    bootstrapMock.waitForBootstrap.mockReset();
    sourcesMock.getEBirdSources.mockReset();
    healthStateMock.recordIngestSuccess.mockReset();
    healthStateMock.recordIngestTick.mockReset();

    ebirdMock.ingestRegion.mockResolvedValue(2);
    bootstrapMock.waitForBootstrap.mockResolvedValue(undefined);
    sourcesMock.getEBirdSources.mockResolvedValue(["US-CA", "US-WA"]);

    job = new IngestJob(
      ebirdMock as unknown as IngestService,
      bootstrapMock as unknown as BootstrapService,
      sourcesMock as unknown as SourcesRepository,
      healthStateMock as unknown as HealthStateService,
      new JobTelemetry(),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("ingests every subscribed region", async () => {
    await job.run();

    expect(ebirdMock.ingestRegion).toHaveBeenCalledTimes(2);
    expect(ebirdMock.ingestRegion).toHaveBeenCalledWith("US-CA");
    expect(ebirdMock.ingestRegion).toHaveBeenCalledWith("US-WA");
  });

  it("continues past a per-region failure", async () => {
    ebirdMock.ingestRegion.mockRejectedValueOnce(new Error("eBird 500"));

    await expect(job.run()).resolves.toBeUndefined();

    expect(ebirdMock.ingestRegion).toHaveBeenCalledTimes(2);
    expect(loggerErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("Failed to ingest US-CA"),
      expect.any(String),
    );
  });

  it("skips the tick without throwing when the region query fails", async () => {
    sourcesMock.getEBirdSources.mockRejectedValue(new Error("db down"));

    await expect(job.run()).resolves.toBeUndefined();

    expect(ebirdMock.ingestRegion).not.toHaveBeenCalled();
    expect(loggerErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("Ingest tick failed"),
      expect.any(String),
    );
  });

  it("skips the tick without throwing when bootstrap times out", async () => {
    bootstrapMock.waitForBootstrap.mockRejectedValue(
      new Error("Bootstrap timed out after 5 minutes"),
    );

    await expect(job.run()).resolves.toBeUndefined();

    expect(sourcesMock.getEBirdSources).not.toHaveBeenCalled();
    expect(loggerErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("Ingest tick failed"),
      expect.any(String),
    );
  });

  it("records the tick and per-region successes in health state", async () => {
    await job.run();

    expect(healthStateMock.recordIngestTick).toHaveBeenCalledWith([
      "US-CA",
      "US-WA",
    ]);
    expect(healthStateMock.recordIngestSuccess).toHaveBeenCalledWith("US-CA");
    expect(healthStateMock.recordIngestSuccess).toHaveBeenCalledWith("US-WA");
  });

  it("does not record success for a failed region", async () => {
    ebirdMock.ingestRegion.mockRejectedValueOnce(new Error("eBird 500"));

    await job.run();

    expect(healthStateMock.recordIngestSuccess).not.toHaveBeenCalledWith(
      "US-CA",
    );
    expect(healthStateMock.recordIngestSuccess).toHaveBeenCalledWith("US-WA");
  });

  it("warns when no sources are configured", async () => {
    sourcesMock.getEBirdSources.mockResolvedValue([]);

    await job.run();

    expect(loggerWarnSpy).toHaveBeenCalledWith(
      "No eBird sources configured; ingest is a no-op",
    );
    expect(healthStateMock.recordIngestTick).toHaveBeenCalledWith([]);
    expect(ebirdMock.ingestRegion).not.toHaveBeenCalled();
  });
});
