import { Module } from "@nestjs/common";
import { DiscordHelper } from "./discord.helper";
import { ListenersModule } from "./listeners/listeners.module";
import { UtilCommands } from "./util.commands";

@Module({
  exports: [DiscordHelper],
  imports: [ListenersModule],
  providers: [DiscordHelper, UtilCommands],
})
export class DiscordModule {}
