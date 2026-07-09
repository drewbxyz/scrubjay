import { Module } from "@nestjs/common";
import { DiscordModule } from "@/discord/discord.module";
import { AlertQueue } from "./alert-queue.service";
import { AlertQueueRepository } from "./alert-queue.repository";
import { EBirdDispatcherService } from "./ebird-dispatcher.service";

@Module({
  exports: [AlertQueue, EBirdDispatcherService],
  imports: [DiscordModule],
  providers: [AlertQueue, AlertQueueRepository, EBirdDispatcherService],
})
export class DispatchModule {}
