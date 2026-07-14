import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import * as schema from "./auth-schema";
import { getDb } from "./db";
import { env } from "./env";

const portalEnv = env();

export const auth = betterAuth({
  account: { modelName: "portal_account" },
  baseURL: portalEnv.BETTER_AUTH_URL,
  database: drizzleAdapter(getDb(), { provider: "pg", schema }),
  // tanstackStartCookies must be the LAST plugin (sets auth cookies on the
  // TanStack Start response). Renamed from reactStartCookies in better-auth 1.6.x.
  plugins: [tanstackStartCookies()],
  secret: portalEnv.BETTER_AUTH_SECRET,
  session: { modelName: "portal_session" },
  socialProviders: {
    discord: {
      clientId: portalEnv.DISCORD_CLIENT_ID,
      clientSecret: portalEnv.DISCORD_CLIENT_SECRET,
    },
  },
  user: { modelName: "portal_user" },
  verification: { modelName: "portal_verification" },
});
