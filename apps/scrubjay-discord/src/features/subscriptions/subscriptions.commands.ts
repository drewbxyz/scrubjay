import { Injectable, UseFilters } from "@nestjs/common";
import { MessageFlags, PermissionsBitField } from "discord.js";
import {
  Context,
  Options,
  SlashCommand,
  type SlashCommandContext,
} from "necord";
import { CommandExceptionFilter } from "@/discord/common/filters/command-exception.filter";
import { SubscribeEBirdOptions } from "./options/subscribe-ebird.options";
import { SubscriptionsService } from "./subscriptions.service";

@Injectable()
@UseFilters(CommandExceptionFilter)
export class SubscriptionsCommands {
  constructor(private readonly subscriptions: SubscriptionsService) {}

  @SlashCommand({
    defaultMemberPermissions: PermissionsBitField.Flags.Administrator,
    description: "Subscribe to eBird observations for a region",
    name: "sub-ebird",
  })
  public async onSubscribeEBird(
    @Context() [interaction]: SlashCommandContext,
    @Options() { region }: SubscribeEBirdOptions,
  ) {
    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
    await this.subscriptions.subscribeToEBird(interaction.channelId, region);
    return interaction.editReply({
      content: `Subscribed to eBird observations for ${region}.`,
    });
  }
}
