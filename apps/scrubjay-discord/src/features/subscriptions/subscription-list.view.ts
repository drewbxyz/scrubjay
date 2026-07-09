import {
  ActionRowBuilder,
  type BaseMessageOptions,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder,
} from "discord.js";

export const PAGE_SIZE = 10;

/** Scrub-jay blue, used for the subscription list embed. */
const EMBED_COLOR = 0x4a90d9;

/** The subset of a subscription row the list view needs to render. */
export type SubscriptionRow = {
  stateCode: string;
  countyCode: string;
};

type SubscriptionListView = Pick<BaseMessageOptions, "embeds" | "components">;

/** '*' county means the whole state; otherwise the county code is the region. */
function subscriptionLabel(sub: SubscriptionRow): string {
  return sub.countyCode === "*"
    ? `${sub.stateCode} — all counties`
    : sub.countyCode;
}

/**
 * The region code the remove handler feeds back to `unsubscribe`: the county
 * code for a county sub, or the state code when it covers the whole state.
 */
function subscriptionValue(sub: SubscriptionRow): string {
  return sub.countyCode === "*" ? sub.stateCode : sub.countyCode;
}

/** Embed line: the region code as an inline-code chip, state subs annotated. */
function subscriptionDisplay(sub: SubscriptionRow): string {
  return sub.countyCode === "*"
    ? `\`${sub.stateCode}\` · all counties`
    : `\`${sub.countyCode}\``;
}

/**
 * Pure render of the paginated subscription list. Owns page clamping, slicing,
 * and the empty state; performs no Discord I/O so it can be unit-tested directly.
 * `page` is zero-indexed and clamped into range.
 */
export function buildSubscriptionListView(
  subs: SubscriptionRow[],
  page: number,
): SubscriptionListView {
  if (subs.length === 0) {
    return {
      components: [],
      embeds: [
        new EmbedBuilder()
          .setColor(EMBED_COLOR)
          .setTitle("Active subscriptions")
          .setDescription("No subscriptions in this channel."),
      ],
    };
  }

  const totalPages = Math.ceil(subs.length / PAGE_SIZE);
  const current = Math.min(Math.max(page, 0), totalPages - 1);
  const start = current * PAGE_SIZE;
  const pageSubs = subs.slice(start, start + PAGE_SIZE);

  const embed = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle("Active subscriptions")
    .setDescription(
      pageSubs.map((s) => `• ${subscriptionDisplay(s)}`).join("\n"),
    )
    .setFooter({
      text:
        totalPages > 1
          ? `Page ${current + 1} of ${totalPages} · ${subs.length} total`
          : `${subs.length} subscription${subs.length === 1 ? "" : "s"}`,
    });

  const menu = new StringSelectMenuBuilder()
    .setCustomId(`subscription/list/remove/${current}`)
    .setPlaceholder("Select a subscription to remove")
    .addOptions(
      pageSubs.map((s) => ({
        label: subscriptionLabel(s),
        value: subscriptionValue(s),
      })),
    );

  const components: NonNullable<SubscriptionListView["components"]>[number][] =
    [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)];

  // Only paginate when there's more than one page: a lone page needs no nav,
  // and two clamped buttons would otherwise share a custom_id (Discord rejects
  // duplicates). The nav handler re-clamps the target page into range on click.
  if (totalPages > 1) {
    const prev = new ButtonBuilder()
      .setCustomId(`subscription/list/nav/${current - 1}`)
      .setLabel("Prev")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(current === 0);

    const next = new ButtonBuilder()
      .setCustomId(`subscription/list/nav/${current + 1}`)
      .setLabel("Next")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(current === totalPages - 1);

    components.push(
      new ActionRowBuilder<ButtonBuilder>().addComponents(prev, next),
    );
  }

  return { components, embeds: [embed] };
}
