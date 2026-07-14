import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { eq } from "drizzle-orm";
import { getAuth } from "@/server/auth";
import { portal_account } from "@/server/auth-schema";
import { getDb } from "@/server/db";
import { env } from "@/server/env";
import { pickDiscordAccountId, resolveSessionStatus } from "@/server/operators";

export type SessionUser =
  | { status: "anonymous" }
  | { name: string; status: "forbidden" }
  | { discordId: string; name: string; status: "operator" };

export const getSessionUser = createServerFn({ method: "GET" }).handler(
  async (): Promise<SessionUser> => {
    const session = await getAuth().api.getSession({
      headers: getRequest().headers,
    });
    if (!session) return { status: "anonymous" };
    const rows = await getDb()
      .select({
        accountId: portal_account.accountId,
        providerId: portal_account.providerId,
      })
      .from(portal_account)
      .where(eq(portal_account.userId, session.user.id));
    const discordId = pickDiscordAccountId(rows);
    if (
      resolveSessionStatus(discordId, env().PORTAL_OPERATOR_IDS) !== "operator"
    ) {
      return { name: session.user.name, status: "forbidden" };
    }
    return {
      discordId: discordId as string,
      name: session.user.name,
      status: "operator",
    };
  },
);
