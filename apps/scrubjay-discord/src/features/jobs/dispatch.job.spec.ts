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
import type { DispatchService } from "@/features/dispatch/dispatch.service";
import type { BootstrapService } from "./bootstrap.service";
import { DispatchJob } from "./dispatch.job";

describe("DispatchJob", () => {
  let job: DispatchJob;
  let loggerErrorSpy: MockInstance;

  const dispatcherMock = { dispatchSince: vi.fn() };
  const bootstrapMock = { waitForBootstrap: vi.fn() };

  beforeEach(() => {
    loggerErrorSpy = vi
      .spyOn(Logger.prototype, "error")
      .mockImplementation(() => {});
    vi.spyOn(Logger.prototype, "debug").mockImplementation(() => {});

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
    vi.restoreAllMocks();
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
      expect.stringContaining("Dispatch tick failed"),
      expect.stringContaining("channel gone"),
    );
  });

  it("skips a tick while the previous one is still running", async () => {
    let release!: () => void;
    dispatcherMock.dispatchSince.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );

    const first = job.run();
    await job.run(); // overlapping tick — must be a no-op

    expect(dispatcherMock.dispatchSince).toHaveBeenCalledTimes(1);

    release();
    await first;

    // The guard resets once the tick finishes.
    dispatcherMock.dispatchSince.mockResolvedValue(undefined);
    await job.run();
    expect(dispatcherMock.dispatchSince).toHaveBeenCalledTimes(2);
  });
});
