import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { DispatchService } from "@/features/dispatch/dispatch.service";
import { BootstrapService } from "./bootstrap.service";

@Injectable()
export class DispatchJob {
  private readonly logger = new Logger(DispatchJob.name);

  /**
   * Re-entrancy guard: @nestjs/schedule does not serialize overlapping cron
   * runs, and an overlapped tick would re-read pending alerts before the
   * running tick records them — double-sending every alert in the slow batch.
   * In-process only: this deployment is single-instance by design (spec §3).
   */
  private inFlight = false;

  constructor(
    private readonly dispatch: DispatchService,
    private readonly bootstrapService: BootstrapService,
  ) {}

  @Cron("*/1 * * * *")
  async run() {
    if (this.inFlight) {
      this.logger.debug("Previous dispatch tick still running; skipping");
      return;
    }
    this.inFlight = true;
    try {
      // Wait for bootstrap to complete before running
      await this.bootstrapService.waitForBootstrap();

      const since = new Date(Date.now() - 15 * 60 * 1000);
      this.logger.debug(
        `Running dispatch job for alerts since ${since.toISOString()}`,
      );
      await this.dispatch.dispatchSince(since);
    } catch (err) {
      this.logger.error(
        `Dispatch tick failed`,
        err instanceof Error ? err.stack : String(err),
      );
    } finally {
      this.inFlight = false;
    }
  }
}
