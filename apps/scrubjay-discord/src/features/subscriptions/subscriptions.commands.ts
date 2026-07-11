import { Injectable, UseFilters } from "@nestjs/common";
import {
  InteractionContextType,
  type MessageComponentInteraction,
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

const PERMISSION_DENIED =
  "You need the Administrator permission to manage subscriptions.";

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
    // Defer before the DB round-trip so a slow query can't blow the 3s
    // interaction-token deadline (parity with `add`).
    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
    const didUnsubscribe = await this.subscriptions.unsubscribe(
      interaction.channelId,
      region,
    );
    if (didUnsubscribe) {
      return interaction.editReply({
        content: `Unsubscribed to eBird observations for ${region}`,
      });
    }
    return interaction.editReply({
      content: `Channel is not subscribed to eBird observations for ${region}`,
    });
  }

  @Subcommand({
    description: "List active ScrubJay subscriptions for the channel",
    name: "list",
  })
  public async onSubscriptionList(
    @Context() [interaction]: SlashCommandContext,
  ) {
    // Defer (ephemeral) before the DB read so the list query can't miss the
    // 3s token deadline; the followup inherits the ephemeral flag.
    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
    const subs = await this.subscriptions.listSubscriptions(
      interaction.channelId,
    );

    return interaction.editReply(buildSubscriptionListView(subs, 0));
  }

  /**
   * Component interactions are matched by customId and bypass the slash
   * command's defaultMemberPermissions gate. The list view is ephemeral so in
   * practice only the invoking admin can click, but re-check explicitly as
   * defense-in-depth.
   */
  private isAdmin(interaction: MessageComponentInteraction): boolean {
    return (
      interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ??
      false
    );
  }

  /** Prev/Next buttons: re-render the requested page in place. */
  @Button("subscription/list/nav/:page")
  public async onSubscriptionListNav(
    @Context() [interaction]: ButtonContext,
    @ComponentParam("page") page: string,
  ) {
    if (!this.isAdmin(interaction)) {
      return interaction.reply({
        content: PERMISSION_DENIED,
        flags: [MessageFlags.Ephemeral],
      });
    }
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
    if (!this.isAdmin(interaction)) {
      return interaction.reply({
        content: PERMISSION_DENIED,
        flags: [MessageFlags.Ephemeral],
      });
    }
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
