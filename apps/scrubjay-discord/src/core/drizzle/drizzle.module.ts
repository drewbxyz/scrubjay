import { Global, Logger, Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import type { AppConfig } from "@/core/config/config.schema";
import * as schema from "./drizzle.schema";
import { DrizzleService } from "./drizzle.service";
import { PG_CONNECTION, PG_POOL } from "./pg-connection";
import { PoolLifecycle } from "./pool-lifecycle";
import { poolNameFields } from "./pool-name";

const CONNECTION_TIMEOUT_MS = 10_000;
const IDLE_TIMEOUT_MS = 30_000;
const STATEMENT_TIMEOUT_MS = 30_000;
const MAX_POOL_CONNECTIONS = 10;

@Global()
@Module({
  exports: [DrizzleService, PG_POOL],
  imports: [ConfigModule],
  providers: [
    {
      inject: [ConfigService],
      provide: PG_POOL,
      useFactory: (configService: ConfigService<AppConfig, true>) => {
        const logger = new Logger("PgPool");
        const databaseUrl = configService.get("DATABASE_URL", { infer: true });
        const pool = new Pool({
          connectionString: databaseUrl,
          connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
          idleTimeoutMillis: IDLE_TIMEOUT_MS,
          max: MAX_POOL_CONNECTIONS,
          statement_timeout: STATEMENT_TIMEOUT_MS,
          // Populate host/port/database so instrumentation-pg can name the pool
          // (db.client.connection.pool.name); connectionString still wins for
          // the actual connection.
          ...poolNameFields(databaseUrl),
        });
        // Without this handler an error on an idle client surfaces as an
        // unhandled 'error' event and crashes the process.
        pool.on("error", (err) => {
          logger.error("Idle pg client error", err.stack);
        });
        return pool;
      },
    },
    {
      inject: [PG_POOL],
      provide: PG_CONNECTION,
      useFactory: (pool: Pool) => drizzle({ client: pool, schema }),
    },
    DrizzleService,
    PoolLifecycle,
  ],
})
export class DrizzleModule {}
