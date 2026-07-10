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
import type { RetentionService } from "@/features/retention/retention.service";
import type { BootstrapService } from "./bootstrap.service";
import { RetentionJob } from "./retention.job";

describe("RetentionJob", () => {
  let job: RetentionJob;
  let loggerErrorSpy: MockInstance;

  const retentionMock = { prune: vi.fn() };
  const bootstrapMock = { waitForBootstrap: vi.fn() };

  beforeEach(() => {
    loggerErrorSpy = vi
      .spyOn(Logger.prototype, "error")
      .mockImplementation(() => {});

    retentionMock.prune.mockReset();
    bootstrapMock.waitForBootstrap.mockReset();
    retentionMock.prune.mockResolvedValue(undefined);
    bootstrapMock.waitForBootstrap.mockResolvedValue(undefined);

    job = new RetentionJob(
      retentionMock as unknown as RetentionService,
      bootstrapMock as unknown as BootstrapService,
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("prunes when bootstrap is complete", async () => {
    await job.run();

    expect(retentionMock.prune).toHaveBeenCalledTimes(1);
  });

  it("skips the run without throwing when bootstrap times out", async () => {
    bootstrapMock.waitForBootstrap.mockRejectedValue(
      new Error("Bootstrap timed out after 5 minutes"),
    );

    await expect(job.run()).resolves.toBeUndefined();

    expect(retentionMock.prune).not.toHaveBeenCalled();
    expect(loggerErrorSpy).toHaveBeenCalled();
  });

  it("logs instead of throwing when pruning fails", async () => {
    retentionMock.prune.mockRejectedValue(new Error("db unreachable"));

    await expect(job.run()).resolves.toBeUndefined();

    expect(loggerErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("Retention run failed"),
      expect.stringContaining("db unreachable"),
    );
  });
});
