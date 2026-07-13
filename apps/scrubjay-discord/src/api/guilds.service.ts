import { Injectable } from "@nestjs/common";
import type { GuildsResponse } from "@scrubjay/api-contracts";
import {
  type Channel,
  ChannelType,
  Client,
  DiscordAPIError,
  PermissionFlagsBits,
} from "discord.js";

@Injectable()
export class GuildsService {
  constructor(private readonly client: Client) {}

  /** Guilds the bot is in, with the text channels it can actually post to. */
  async listGuilds(): Promise<GuildsResponse> {
    const guilds: GuildsResponse["guilds"] = [];
    for (const guild of this.client.guilds.cache.values()) {
      const me = guild.members.me;
      const channels = await guild.channels.fetch();
      const sendable = [...channels.values()]
        .filter((channel) => channel !== null)
        .filter((channel) => channel.type === ChannelType.GuildText)
        .filter((channel) => {
          if (!me) {
            return false;
          }
          const permissions = channel.permissionsFor(me);
          return (
            permissions?.has([
              PermissionFlagsBits.SendMessages,
              PermissionFlagsBits.ViewChannel,
            ]) ?? false
          );
        })
        .map((channel) => ({ id: channel.id, name: channel.name }))
        .sort((a, b) => a.name.localeCompare(b.name));
      guilds.push({ channels: sendable, id: guild.id, name: guild.name });
    }
    guilds.sort((a, b) => a.name.localeCompare(b.name));
    return { guilds };
  }

  /** True when the id is a guild text channel the bot can post to. */
  async isPostableChannel(channelId: string): Promise<boolean> {
    let channel: Channel | null;
    try {
      channel = await this.client.channels.fetch(channelId);
    } catch (err) {
      // Unknown channel / missing access — anything Discord itself rejects.
      if (err instanceof DiscordAPIError) {
        return false;
      }
      throw err;
    }
    if (!channel || channel.type !== ChannelType.GuildText) {
      return false;
    }
    const me = channel.guild.members.me;
    if (!me) {
      return false;
    }
    return channel
      .permissionsFor(me)
      .has([PermissionFlagsBits.SendMessages, PermissionFlagsBits.ViewChannel]);
  }
}
