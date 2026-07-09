import { Module } from "@nestjs/common";
import { DispatchModule } from "@/features/dispatch/dispatch.module";
import { SubscriptionsCommands } from "./subscriptions.commands";
import { SubscriptionsRepository } from "./subscriptions.repository";
import { SubscriptionsService } from "./subscriptions.service";

@Module({
  imports: [DispatchModule],
  providers: [
    SubscriptionsCommands,
    SubscriptionsRepository,
    SubscriptionsService,
  ],
})
export class SubscriptionsModule {}
