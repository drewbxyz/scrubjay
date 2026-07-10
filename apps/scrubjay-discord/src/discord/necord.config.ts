import { GatewayIntentBits, Partials } from "discord.js";
import type { NecordModuleOptions } from "necord";
import type { AppConfig } from "@/core/config/config.schema";

export function createNecordOptions(
  config: Pick<AppConfig, "DEVELOPMENT_GUILD_ID" | "DISCORD_TOKEN">,
): NecordModuleOptions {
  return {
    development: config.DEVELOPMENT_GUILD_ID
      ? [config.DEVELOPMENT_GUILD_ID]
      : false,
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessageReactions,
    ],
    partials: [Partials.Message, Partials.Channel, Partials.Reaction],
    token: config.DISCORD_TOKEN,
  };
}
