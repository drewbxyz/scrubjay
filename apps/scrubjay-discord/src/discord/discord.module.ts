import { Module } from "@nestjs/common";
import { ChannelSenderService } from "./channel-sender.service";
import { LifecycleUpdate } from "./lifecycle.update";

@Module({
  exports: [ChannelSenderService],
  providers: [ChannelSenderService, LifecycleUpdate],
})
export class DiscordModule {}
