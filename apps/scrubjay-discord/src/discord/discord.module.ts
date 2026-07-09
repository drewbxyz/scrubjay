import { Module } from "@nestjs/common";
import { CommandsModule } from "./commands/commands.module";
import { DiscordHelper } from "./discord.helper";
import { ListenersModule } from "./listeners/listeners.module";

@Module({
  exports: [DiscordHelper],
  imports: [CommandsModule, ListenersModule],
  providers: [DiscordHelper],
})
export class DiscordModule {}
