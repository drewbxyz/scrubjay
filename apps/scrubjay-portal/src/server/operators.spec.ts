import { describe, expect, it } from "vitest";
import { pickDiscordAccountId, resolveSessionStatus } from "./operators";

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
