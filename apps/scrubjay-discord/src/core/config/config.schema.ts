import { z } from "zod";

export const configSchema = z.object({
  DATABASE_URL: z.url(),
  DEVELOPMENT_GUILD_ID: z.string().optional(),
  // Development only: used for slash-command registration.
  DISCORD_CLIENT_ID: z.string().optional(),
  DISCORD_TOKEN: z.string().min(1),
  EBIRD_BASE_URL: z.url().default("https://api.ebird.org/"),
  EBIRD_TOKEN: z.string().min(1),
  FILTER_REACTION_THRESHOLD: z.coerce.number().int().min(1).default(3),
  PORT: z.coerce.number().int().default(3000),
});

export type AppConfig = z.infer<typeof configSchema>;

export function validateConfig(env: Record<string, unknown>): AppConfig {
  const result = configSchema.safeParse(env);
  if (!result.success) {
    throw new Error(`Invalid environment:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
