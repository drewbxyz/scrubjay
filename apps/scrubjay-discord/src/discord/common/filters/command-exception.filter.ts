import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  Logger,
} from "@nestjs/common";
import { MessageFlags } from "discord.js";
import { NecordArgumentsHost, type SlashCommandContext } from "necord";
import { InvalidRegionError } from "@/features/subscriptions/invalid-region.error";

const GENERIC_MESSAGE = "Something went wrong running that command.";

@Catch()
export class CommandExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(CommandExceptionFilter.name);

  async catch(exception: unknown, host: ArgumentsHost) {
    const [interaction] =
      NecordArgumentsHost.create(host).getContext<SlashCommandContext>();

    const error =
      exception instanceof Error ? exception : new Error(String(exception));
    this.logger.error(error.message, error.stack);

    const content =
      exception instanceof InvalidRegionError
        ? exception.message
        : GENERIC_MESSAGE;

    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ content });
    } else {
      await interaction.reply({ content, flags: [MessageFlags.Ephemeral] });
    }
  }
}
