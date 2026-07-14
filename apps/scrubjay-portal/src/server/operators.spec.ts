import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start/server", () => ({
  getRequest: () => ({ headers: new Headers() }),
}));
vi.mock("./auth", () => ({ getAuth: vi.fn() }));
vi.mock("./db", () => ({ getDb: vi.fn() }));
vi.mock("./env", () => ({ env: vi.fn() }));

import { getAuth } from "./auth";
import { getDb } from "./db";
import { env } from "./env";
import {
  ForbiddenError,
  pickDiscordAccountId,
  requireOperator,
  resolveSessionStatus,
  UnauthenticatedError,
} from "./operators";

describe("pickDiscordAccountId", () => {
  it("returns the discord account id", () => {
    const accounts = [
      { accountId: "gh-1", providerId: "github" },
      { accountId: "123456789012345678", providerId: "discord" },
    ];
    expect(pickDiscordAccountId(accounts)).toBe("123456789012345678");
  });

  it("returns undefined when no discord account is linked", () => {
    expect(
      pickDiscordAccountId([{ accountId: "x", providerId: "github" }]),
    ).toBeUndefined();
  });
});

describe("resolveSessionStatus", () => {
  const allowlist = ["123456789012345678"];

  it("grants operators on the allowlist", () => {
    expect(resolveSessionStatus("123456789012345678", allowlist)).toBe(
      "operator",
    );
  });

  it("forbids authenticated non-operators and missing discord links", () => {
    expect(resolveSessionStatus("999999999999999999", allowlist)).toBe(
      "forbidden",
    );
    expect(resolveSessionStatus(undefined, allowlist)).toBe("forbidden");
  });
});

const ALLOWLIST = ["123456789012345678"];

function stubSession(session: unknown) {
  vi.mocked(getAuth).mockReturnValue({
    api: { getSession: async () => session },
  } as never);
}

function stubAccounts(rows: { accountId: string; providerId: string }[]) {
  vi.mocked(getDb).mockReturnValue({
    select: () => ({ from: () => ({ where: () => Promise.resolve(rows) }) }),
  } as never);
}

describe("requireOperator", () => {
  beforeEach(() => {
    vi.mocked(env).mockReturnValue({
      PORTAL_OPERATOR_IDS: ALLOWLIST,
    } as never);
  });

  it("throws UnauthenticatedError when there is no session", async () => {
    stubSession(null);
    await expect(requireOperator()).rejects.toBeInstanceOf(
      UnauthenticatedError,
    );
  });

  it("throws ForbiddenError when the discord id is not on the allowlist", async () => {
    stubSession({ user: { id: "u1", name: "Ada" } });
    stubAccounts([{ accountId: "999999999999999999", providerId: "discord" }]);
    await expect(requireOperator()).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("throws ForbiddenError when no discord account is linked", async () => {
    stubSession({ user: { id: "u1", name: "Ada" } });
    stubAccounts([{ accountId: "gh-1", providerId: "github" }]);
    await expect(requireOperator()).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("returns the operator session for an allowlisted discord id", async () => {
    stubSession({ user: { id: "u1", name: "Ada" } });
    stubAccounts([{ accountId: "123456789012345678", providerId: "discord" }]);
    await expect(requireOperator()).resolves.toEqual({
      discordId: "123456789012345678",
      name: "Ada",
      userId: "u1",
    });
  });
});
