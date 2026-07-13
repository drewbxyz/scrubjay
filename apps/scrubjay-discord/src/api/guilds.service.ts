import { Injectable } from "@nestjs/common";
import type { GuildsResponse } from "@scrubjay/api-contracts";
import { ChannelType, Client, PermissionFlagsBits } from "discord.js";

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
}
