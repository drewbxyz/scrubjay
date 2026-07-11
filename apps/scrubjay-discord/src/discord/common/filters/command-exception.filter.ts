import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  Logger,
} from "@nestjs/common";
import { MessageFlags } from "discord.js";
import {
  type ButtonContext,
  NecordArgumentsHost,
  type SlashCommandContext,
  type StringSelectContext,
} from "necord";
import { UserFacingError } from "../errors/user-facing.error";

const GENERIC_MESSAGE = "Something went wrong running that command.";

/**
 * This filter guards @SlashCommand, @Button, and @StringSelect handlers on the
 * subscription commands, so the recovered context is any of the three — all
 * carry a repliable interaction.
 */
type CommandContext = SlashCommandContext | ButtonContext | StringSelectContext;

@Catch()
export class CommandExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(CommandExceptionFilter.name);

  async catch(exception: unknown, host: ArgumentsHost) {
    const [interaction] =
      NecordArgumentsHost.create(host).getContext<CommandContext>();

    const error =
      exception instanceof Error ? exception : new Error(String(exception));
    this.logger.error(error.message, error.stack);

    const content =
      error instanceof UserFacingError ? error.message : GENERIC_MESSAGE;

    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ content });
      } else {
        await interaction.reply({ content, flags: [MessageFlags.Ephemeral] });
      }
    } catch (replyError) {
      const err =
        replyError instanceof Error
          ? replyError
          : new Error(String(replyError));
      this.logger.error(
        `Failed to send error reply: ${err.message}`,
        err.stack,
      );
    }
  }
}
