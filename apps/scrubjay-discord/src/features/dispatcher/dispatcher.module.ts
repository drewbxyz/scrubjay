import { Module } from "@nestjs/common";
import { DiscordModule } from "@/discord/discord.module";
import { DeliveriesModule } from "@/features/deliveries/deliveries.module";
import { DispatcherRepository } from "./dispatcher.repository";
import { EBirdDispatcherService } from "./dispatchers/ebird-dispatcher.service";

@Module({
  exports: [EBirdDispatcherService],
  imports: [DeliveriesModule, DiscordModule],
  providers: [DispatcherRepository, EBirdDispatcherService],
})
export class DispatcherModule {}
