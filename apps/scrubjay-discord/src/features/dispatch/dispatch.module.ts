import { Module } from "@nestjs/common";
import { DiscordModule } from "@/discord/discord.module";
import { AlertQueueRepository } from "./alert-queue.repository";
import { AlertQueue } from "./alert-queue.service";
import { DispatchService } from "./dispatch.service";

@Module({
  exports: [AlertQueue, DispatchService],
  imports: [DiscordModule],
  providers: [AlertQueue, AlertQueueRepository, DispatchService],
})
export class DispatchModule {}
