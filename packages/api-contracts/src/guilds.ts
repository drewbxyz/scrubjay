import { z } from "zod";

export const guildChannelSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
});
export type GuildChannel = z.infer<typeof guildChannelSchema>;

/** Only text channels where the bot can view + send are included. */
export const guildSchema = z.object({
  channels: z.array(guildChannelSchema),
  id: z.string().min(1),
  name: z.string(),
});
export type Guild = z.infer<typeof guildSchema>;

export const guildsResponseSchema = z.object({
  guilds: z.array(guildSchema),
});
export type GuildsResponse = z.infer<typeof guildsResponseSchema>;
