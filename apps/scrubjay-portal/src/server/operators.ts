import { getRequest } from "@tanstack/react-start/server";
import { eq } from "drizzle-orm";
import { auth } from "./auth";
import { portal_account } from "./auth-schema";
import { getDb } from "./db";
import { env } from "./env";

export class UnauthenticatedError extends Error {
  constructor() {
    super("not signed in");
    this.name = "UnauthenticatedError";
  }
}

export class ForbiddenError extends Error {
  constructor() {
    super("not an operator");
    this.name = "ForbiddenError";
  }
}

export interface OperatorSession {
  discordId: string;
  name: string;
  userId: string;
}

export function pickDiscordAccountId(
  accounts: { accountId: string; providerId: string }[],
): string | undefined {
  return accounts.find((account) => account.providerId === "discord")
    ?.accountId;
}

export function resolveSessionStatus(
  discordId: string | undefined,
  allowlist: string[],
): "forbidden" | "operator" {
  return discordId !== undefined && allowlist.includes(discordId)
    ? "operator"
    : "forbidden";
}

async function discordIdForUser(userId: string): Promise<string | undefined> {
  const rows = await getDb()
    .select({
      accountId: portal_account.accountId,
      providerId: portal_account.providerId,
    })
    .from(portal_account)
    .where(eq(portal_account.userId, userId));
  return pickDiscordAccountId(rows);
}

/** Session + allowlist gate; every data server function calls this first. */
export async function requireOperator(): Promise<OperatorSession> {
  const session = await auth.api.getSession({ headers: getRequest().headers });
  if (!session) throw new UnauthenticatedError();
  const discordId = await discordIdForUser(session.user.id);
  if (
    resolveSessionStatus(discordId, env().PORTAL_OPERATOR_IDS) !== "operator"
  ) {
    throw new ForbiddenError();
  }
  return {
    discordId: discordId as string,
    name: session.user.name,
    userId: session.user.id,
  };
}
