import { Injectable, Logger, UseFilters } from "@nestjs/common";
import { Context, SlashCommand, type SlashCommandContext } from "necord";
import { CommandExceptionFilter } from "@/discord/common/filters/command-exception.filter";

@Injectable()
@UseFilters(CommandExceptionFilter)
export class HealthCommands {
  private readonly logger = new Logger(HealthCommands.name);

  @SlashCommand({
    description: "Responds with latency",
    name: "ping",
  })
  public async onPing(@Context() [interaction]: SlashCommandContext) {
    this.logger.debug("Received ping command.");
    const latency = Date.now() - interaction.createdTimestamp;

    if (latency < 0) {
      return interaction.reply({
        content: `Something weird happened... latency was ${latency}ms`,
      });
    }
    return interaction.reply({ content: `Pong! Latency: ${latency}ms` });
  }
}
