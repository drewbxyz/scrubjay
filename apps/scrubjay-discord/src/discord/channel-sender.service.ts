import { Injectable } from "@nestjs/common";
import { Client, type MessageCreateOptions } from "discord.js";

@Injectable()
export class ChannelSenderService {
  constructor(private readonly client: Client) {}

  async send(
    channelId: string,
    options: string | MessageCreateOptions,
  ): Promise<void> {
    const channel = await this.client.channels.fetch(channelId);
    if (!channel?.isSendable()) {
      throw new Error(`Channel ${channelId} not found or not sendable`);
    }
    await channel.send(options);
  }
}
