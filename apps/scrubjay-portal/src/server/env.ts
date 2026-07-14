import { z } from "zod";

const snowflake = z.string().regex(/^\d{17,20}$/);

const envSchema = z.object({
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.url(),
  BOT_API_URL: z.url(),
  DATABASE_URL: z.url(),
  DISCORD_CLIENT_ID: z.string().min(1),
  DISCORD_CLIENT_SECRET: z.string().min(1),
  PORTAL_OPERATOR_IDS: z
    .string()
    .transform((raw) =>
      raw
        .split(",")
        .map((id) => id.trim())
        .filter((id) => id.length > 0),
    )
    .pipe(z.array(snowflake).min(1)),
  SCRUBJAY_API_TOKEN: z.string().min(32),
});

export type PortalEnv = z.infer<typeof envSchema>;

export function parseEnv(source: NodeJS.ProcessEnv): PortalEnv {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    throw new Error(`Invalid environment:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}

let cached: PortalEnv | undefined;

export function env(): PortalEnv {
  cached ??= parseEnv(process.env);
  return cached;
}
