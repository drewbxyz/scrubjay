import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { EBirdDispatcherService } from "@/features/dispatch/ebird-dispatcher.service";
import { BootstrapService } from "./bootstrap.service";

@Injectable()
export class DispatchJob {
  private readonly logger = new Logger(DispatchJob.name);

  constructor(
    private readonly ebirdDispatcher: EBirdDispatcherService,
    private readonly bootstrapService: BootstrapService,
  ) {}

  @Cron("*/1 * * * *")
  async run() {
    // Wait for bootstrap to complete before running
    await this.bootstrapService.waitForBootstrap();

    const since = new Date(Date.now() - 15 * 60 * 1000);
    this.logger.debug(
      `Running dispatch job for alerts since ${since.toISOString()}`,
    );
    await this.ebirdDispatcher.dispatchSince(since);
  }
}
