import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
} from "@nestjs/common";
import type { Pool } from "pg";
import { PG_POOL } from "./pg-connection";

/**
 * Ends the pg Pool on shutdown so in-flight connections drain instead of
 * being torn down mid-transaction. Requires app.enableShutdownHooks().
 */
@Injectable()
export class PoolLifecycle implements OnModuleDestroy {
  private readonly logger = new Logger(PoolLifecycle.name);

  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async onModuleDestroy(): Promise<void> {
    this.logger.log("Closing pg pool...");
    await this.pool.end();
  }
}
