import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { ScheduleModule } from "@nestjs/schedule";
import { NecordModule } from "necord";
import { type AppConfig, validateConfig } from "@/core/config/config.schema";
import { FiltersModule } from "@/features/filters/filters.module";
import { JobsModule } from "@/features/jobs/jobs.module";
import { SubscriptionsModule } from "@/features/subscriptions/subscriptions.module";
import { DrizzleModule } from "./core/drizzle/drizzle.module";
import { DiscordModule } from "./discord/discord.module";
import { createNecordOptions } from "./discord/necord.config";

@Module({
  imports: [
    ScheduleModule.forRoot(),
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateConfig,
    }),
    DrizzleModule,
    NecordModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService<AppConfig, true>) =>
        createNecordOptions({
          DEVELOPMENT_GUILD_ID: configService.get("DEVELOPMENT_GUILD_ID", {
            infer: true,
          }),
          DISCORD_TOKEN: configService.get("DISCORD_TOKEN", { infer: true }),
        }),
    }),
    DiscordModule,
    FiltersModule,
    SubscriptionsModule,
    JobsModule,
  ],
  providers: [],
})
export class AppModule {}
