import { Logger } from "@nestjs/common";
import type { DispatchService } from "@/features/dispatch/dispatch.service";
import type { BootstrapService } from "../bootstrap.service";
import { DispatchJob } from "../dispatch.job";

describe("DispatchJob", () => {
  let job: DispatchJob;
  let loggerErrorSpy: jest.SpyInstance;

  const dispatcherMock = { dispatchSince: jest.fn() };
  const bootstrapMock = { waitForBootstrap: jest.fn() };

  beforeEach(() => {
    loggerErrorSpy = jest.spyOn(Logger.prototype, "error").mockImplementation();
    jest.spyOn(Logger.prototype, "debug").mockImplementation();

    dispatcherMock.dispatchSince.mockClear();
    bootstrapMock.waitForBootstrap.mockClear();

    dispatcherMock.dispatchSince.mockResolvedValue(undefined);
    bootstrapMock.waitForBootstrap.mockResolvedValue(undefined);

    job = new DispatchJob(
      dispatcherMock as unknown as DispatchService,
      bootstrapMock as unknown as BootstrapService,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("dispatches when bootstrap is complete", async () => {
    await job.run();

    expect(dispatcherMock.dispatchSince).toHaveBeenCalledTimes(1);
  });

  it("skips the tick without throwing when bootstrap times out (B7)", async () => {
    bootstrapMock.waitForBootstrap.mockRejectedValue(
      new Error("Bootstrap timed out after 5 minutes"),
    );

    await expect(job.run()).resolves.toBeUndefined();

    expect(dispatcherMock.dispatchSince).not.toHaveBeenCalled();
    expect(loggerErrorSpy).toHaveBeenCalled();
  });

  it("logs instead of throwing when dispatch fails (B8)", async () => {
    dispatcherMock.dispatchSince.mockRejectedValue(new Error("channel gone"));

    await expect(job.run()).resolves.toBeUndefined();

    expect(loggerErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("channel gone"),
    );
  });
});
