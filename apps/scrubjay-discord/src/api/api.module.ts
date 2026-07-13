import { Module } from "@nestjs/common";
import { DispatchModule } from "@/features/dispatch/dispatch.module";
import { FiltersModule } from "@/features/filters/filters.module";
import { SubscriptionsModule } from "@/features/subscriptions/subscriptions.module";

/**
 * Operator REST API. Registered by AppModule only when SCRUBJAY_API_TOKEN is
 * set — a bot without a portal runs with no HTTP surface beyond /health.
 */
@Module({
  controllers: [],
  imports: [DispatchModule, FiltersModule, SubscriptionsModule],
  providers: [],
})
export class ApiModule {}
