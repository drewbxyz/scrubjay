import { Module } from "@nestjs/common";
import { ChannelSenderService } from "./channel-sender.service";
import { LifecycleUpdate } from "./lifecycle.update";
import { UtilCommands } from "./util.commands";

@Module({
  exports: [ChannelSenderService],
  providers: [ChannelSenderService, LifecycleUpdate, UtilCommands],
})
export class DiscordModule {}
