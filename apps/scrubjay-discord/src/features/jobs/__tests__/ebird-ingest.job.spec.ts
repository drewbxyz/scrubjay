import { Logger } from "@nestjs/common";
import type { EBirdService } from "@/features/ebird/ebird.service";
import type { SourcesRepository } from "@/features/sources/sources.repository";
import type { BootstrapService } from "../bootstrap.service";
import { EBirdIngestJob } from "../ebird-ingest.job";

describe("EBirdIngestJob", () => {
  let job: EBirdIngestJob;
  let loggerErrorSpy: jest.SpyInstance;

  const ebirdMock = { ingestRegion: jest.fn() };
  const bootstrapMock = { waitForBootstrap: jest.fn() };
  const sourcesMock = { getEBirdSources: jest.fn() };

  beforeEach(() => {
    loggerErrorSpy = jest.spyOn(Logger.prototype, "error").mockImplementation();
    jest.spyOn(Logger.prototype, "debug").mockImplementation();
    jest.spyOn(Logger.prototype, "log").mockImplementation();

    ebirdMock.ingestRegion.mockReset();
    bootstrapMock.waitForBootstrap.mockReset();
    sourcesMock.getEBirdSources.mockReset();

    ebirdMock.ingestRegion.mockResolvedValue(2);
    bootstrapMock.waitForBootstrap.mockResolvedValue(undefined);
    sourcesMock.getEBirdSources.mockResolvedValue(["US-CA", "US-WA"]);

    job = new EBirdIngestJob(
      ebirdMock as unknown as EBirdService,
      bootstrapMock as unknown as BootstrapService,
      sourcesMock as unknown as SourcesRepository,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
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
    );
  });

  it("skips the tick without throwing when the region query fails", async () => {
    sourcesMock.getEBirdSources.mockRejectedValue(new Error("db down"));

    await expect(job.run()).resolves.toBeUndefined();

    expect(ebirdMock.ingestRegion).not.toHaveBeenCalled();
    expect(loggerErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("Ingest tick failed"),
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
    );
  });
});
