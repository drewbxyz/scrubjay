import { Global, Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { drizzle } from "drizzle-orm/node-postgres";
import type { AppConfig } from "@/core/config/config.schema";
import * as schema from "./drizzle.schema";
import { DrizzleService } from "./drizzle.service";
import { PG_CONNECTION } from "./pg-connection";

@Global()
@Module({
  exports: [DrizzleService],
  imports: [ConfigModule],
  providers: [
    {
      inject: [ConfigService],
      provide: PG_CONNECTION,
      useFactory: (configService: ConfigService<AppConfig, true>) =>
        drizzle(configService.get("DATABASE_URL", { infer: true }), {
          schema,
        }),
    },
    DrizzleService,
  ],
})
export class DrizzleModule {}
