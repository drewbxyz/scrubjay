import { Injectable, UseFilters } from "@nestjs/common";
import {
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
} from "discord.js";
import {
  Button,
  type ButtonContext,
  ComponentParam,
  Context,
  createCommandGroupDecorator,
  Options,
  SelectedStrings,
  type SlashCommandContext,
  StringSelect,
  type StringSelectContext,
  Subcommand,
} from "necord";
import { CommandExceptionFilter } from "@/discord/common/filters/command-exception.filter";
import { SubscribeEBirdOptions } from "./options/subscribe-ebird.options";
import { buildSubscriptionListView } from "./subscription-list.view";
import { SubscriptionsService } from "./subscriptions.service";

const SubscriptionCommand = createCommandGroupDecorator({
  contexts: [InteractionContextType.Guild],
  defaultMemberPermissions: [PermissionFlagsBits.Administrator],
  description: "Manage ScrubJay subscriptions for a channel",
  name: "subscription",
});

@Injectable()
@SubscriptionCommand()
@UseFilters(CommandExceptionFilter)
export class SubscriptionsCommands {
  constructor(private readonly subscriptions: SubscriptionsService) {}

  @Subcommand({
    description: "Add a ScrubJay subscription to the channel",
    name: "add",
  })
  public async onSubscriptionAdd(
    @Context() [interaction]: SlashCommandContext,
    @Options() { region }: SubscribeEBirdOptions,
  ) {
    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
    const didSubscribe = await this.subscriptions.subscribe(
      interaction.channelId,
      region,
    );

    if (didSubscribe) {
      return interaction.editReply({
        content: `Subscribed to eBird observations for ${region}.`,
      });
    }

    return interaction.editReply({
      content: `You are already subscribed to eBird observations for ${region}`,
    });
  }

  @Subcommand({
    description: "Remove a ScrubJay subcription from the channel",
    name: "remove",
  })
  public async onSubscriptionRemove(
    @Context() [interaction]: SlashCommandContext,
    @Options() { region }: SubscribeEBirdOptions,
  ) {
    const didUnsubscribe = await this.subscriptions.unsubscribe(
      interaction.channelId,
      region,
    );
    if (didUnsubscribe) {
      return interaction.reply({
        content: `Unsubscribed to eBird observations for ${region}`,
        flags: [MessageFlags.Ephemeral],
      });
    }
    return interaction.reply({
      content: `Channel is not subscribed to eBird observations for ${region}`,
      flags: [MessageFlags.Ephemeral],
    });
  }

  @Subcommand({
    description: "List active ScrubJay subscriptions for the channel",
    name: "list",
  })
  public async onSubscriptionList(
    @Context() [interaction]: SlashCommandContext,
  ) {
    const subs = await this.subscriptions.listSubscriptions(
      interaction.channelId,
    );

    return interaction.reply({
      ...buildSubscriptionListView(subs, 0),
      flags: [MessageFlags.Ephemeral],
    });
  }

  /** Prev/Next buttons: re-render the requested page in place. */
  @Button("subscription/list/nav/:page")
  public async onSubscriptionListNav(
    @Context() [interaction]: ButtonContext,
    @ComponentParam("page") page: string,
  ) {
    const subs = await this.subscriptions.listSubscriptions(
      interaction.channelId,
    );

    return interaction.update(
      buildSubscriptionListView(subs, Number.parseInt(page, 10) || 0),
    );
  }

  /** Remove the selected subscription, then re-render the (clamped) page. */
  @StringSelect("subscription/list/remove/:page")
  public async onSubscriptionListRemove(
    @Context() [interaction]: StringSelectContext,
    @ComponentParam("page") page: string,
    @SelectedStrings() [region]: string[],
  ) {
    await interaction.deferUpdate();
    await this.subscriptions.unsubscribe(interaction.channelId, region);

    const subs = await this.subscriptions.listSubscriptions(
      interaction.channelId,
    );

    return interaction.editReply(
      buildSubscriptionListView(subs, Number.parseInt(page, 10) || 0),
    );
  }
}
