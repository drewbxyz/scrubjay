import { describe, expect, it } from "vitest";
import { parseEnv } from "./env";

const VALID = {
  BETTER_AUTH_SECRET: "s".repeat(32),
  BETTER_AUTH_URL: "http://localhost:3100",
  BOT_API_URL: "http://localhost:3000",
  DATABASE_URL: "postgresql://u:p@localhost:5432/db",
  DISCORD_CLIENT_ID: "abc",
  DISCORD_CLIENT_SECRET: "def",
  PORTAL_OPERATOR_IDS: "123456789012345678, 876543210987654321",
  SCRUBJAY_API_TOKEN: "t".repeat(32),
};

describe("parseEnv", () => {
  it("parses a valid environment and splits the operator allowlist", () => {
    const env = parseEnv(VALID);
    expect(env.PORTAL_OPERATOR_IDS).toEqual([
      "123456789012345678",
      "876543210987654321",
    ]);
    expect(env.BOT_API_URL).toBe("http://localhost:3000");
  });

  it("rejects a missing variable with a readable message", () => {
    const { DATABASE_URL: _omitted, ...rest } = VALID;
    expect(() => parseEnv(rest)).toThrow(/Invalid environment/);
  });

  it("rejects an empty allowlist", () => {
    expect(() => parseEnv({ ...VALID, PORTAL_OPERATOR_IDS: " , " })).toThrow();
  });

  it("rejects non-snowflake operator ids", () => {
    expect(() =>
      parseEnv({ ...VALID, PORTAL_OPERATOR_IDS: "notanid" }),
    ).toThrow();
  });

  it("rejects a short bot API token", () => {
    expect(() => parseEnv({ ...VALID, SCRUBJAY_API_TOKEN: "short" })).toThrow();
  });
});
