import { Module } from "@nestjs/common";
import { SubscriptionsCommands } from "./subscriptions.commands";
import { SubscriptionsRepository } from "./subscriptions.repository";
import { SubscriptionsService } from "./subscriptions.service";

@Module({
  exports: [SubscriptionsService],
  providers: [
    SubscriptionsCommands,
    SubscriptionsRepository,
    SubscriptionsService,
  ],
})
export class SubscriptionsModule {}
