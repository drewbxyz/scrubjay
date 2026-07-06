import { Module } from "@nestjs/common";
import { DiscordModule } from "@/discord/discord.module";
import { AlertQueue } from "./alert-queue";
import { EBirdDispatcherService } from "./ebird-dispatcher.service";

@Module({
  exports: [AlertQueue, EBirdDispatcherService],
  imports: [DiscordModule],
  providers: [AlertQueue, EBirdDispatcherService],
})
export class DispatchModule {}
