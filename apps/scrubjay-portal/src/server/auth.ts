import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import * as schema from "./auth-schema";
import { getDb } from "./db";
import { env } from "./env";

function createAuth() {
  const portalEnv = env();
  return betterAuth({
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
}

type Auth = ReturnType<typeof createAuth>;

let instance: Auth | undefined;

/**
 * Lazily construct the Better Auth instance. Importing this module must have no
 * side effects: building it at module scope would parse env, open a pg Pool,
 * and freeze env before tests can stub it (see the lazy-import pattern in the
 * server specs).
 */
export function getAuth(): Auth {
  instance ??= createAuth();
  return instance;
}
