import { Module } from "@nestjs/common";
import { ChannelSenderService } from "./channel-sender.service";
import { ListenersModule } from "./listeners/listeners.module";
import { UtilCommands } from "./util.commands";

@Module({
  exports: [ChannelSenderService],
  imports: [ListenersModule],
  providers: [ChannelSenderService, UtilCommands],
})
export class DiscordModule {}
