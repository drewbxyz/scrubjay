import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { RetentionService } from "@/features/retention/retention.service";
import { BootstrapService } from "./bootstrap.service";

@Injectable()
export class RetentionJob {
  private readonly logger = new Logger(RetentionJob.name);

  constructor(
    private readonly retention: RetentionService,
    private readonly bootstrapService: BootstrapService,
  ) {}

  /**
   * Daily at 04:17 — an arbitrary quiet minute, off the top of the hour.
   * No in-flight guard: daily cadence cannot self-overlap, and the prunes
   * are idempotent regardless.
   */
  @Cron("17 4 * * *")
  async run() {
    try {
      await this.bootstrapService.waitForBootstrap();
      await this.retention.prune();
    } catch (err) {
      this.logger.error(
        `Retention run failed`,
        err instanceof Error ? err.stack : String(err),
      );
    }
  }
}
