import { Module } from "@nestjs/common";
import { DispatchModule } from "@/features/dispatch/dispatch.module";
import { FiltersModule } from "@/features/filters/filters.module";
import { SubscriptionsModule } from "@/features/subscriptions/subscriptions.module";
import { EBirdRegionsController } from "./ebird-regions.controller";
import { EBirdRegionsService } from "./ebird-regions.service";
import { FiltersController } from "./filters.controller";
import { GuildsController } from "./guilds.controller";
import { GuildsService } from "./guilds.service";
import { OpsController } from "./ops.controller";
import { OpsRepository } from "./ops.repository";
import { SubscriptionsController } from "./subscriptions.controller";

/**
 * Operator REST API. Registered by AppModule only when SCRUBJAY_API_TOKEN is
 * set — a bot without a portal runs with no HTTP surface beyond /health.
 */
@Module({
  controllers: [
    EBirdRegionsController,
    FiltersController,
    GuildsController,
    OpsController,
    SubscriptionsController,
  ],
  imports: [DispatchModule, FiltersModule, SubscriptionsModule],
  providers: [EBirdRegionsService, GuildsService, OpsRepository],
})
export class ApiModule {}
