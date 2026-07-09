import { validateConfig } from "../config.schema";

const validEnv = {
  DATABASE_URL: "postgres://user:pass@localhost:5432/scrubjay",
  DISCORD_TOKEN: "discord-token",
  EBIRD_TOKEN: "ebird-token",
};

describe("validateConfig", () => {
  it("accepts a minimal valid env and applies defaults", () => {
    const config = validateConfig(validEnv);

    expect(config.DATABASE_URL).toBe(validEnv.DATABASE_URL);
    expect(config.PORT).toBe(3000);
    expect(config.EBIRD_BASE_URL).toBe("https://api.ebird.org/");
    expect(config.DEVELOPMENT_GUILD_ID).toBeUndefined();
    expect(config.DISCORD_CLIENT_ID).toBeUndefined();
  });

  it("coerces PORT from string to number", () => {
    const config = validateConfig({ ...validEnv, PORT: "8080" });

    expect(config.PORT).toBe(8080);
  });

  it.each([
    "DATABASE_URL",
    "DISCORD_TOKEN",
    "EBIRD_TOKEN",
  ])("rejects an env missing %s, naming the variable", (key) => {
    const env: Record<string, unknown> = { ...validEnv };
    delete env[key];

    expect(() => validateConfig(env)).toThrow(key);
  });

  it("rejects a non-URL DATABASE_URL", () => {
    expect(() =>
      validateConfig({ ...validEnv, DATABASE_URL: "not-a-url" }),
    ).toThrow("DATABASE_URL");
  });

  it("rejects a non-URL EBIRD_BASE_URL", () => {
    expect(() =>
      validateConfig({ ...validEnv, EBIRD_BASE_URL: "not-a-url" }),
    ).toThrow("EBIRD_BASE_URL");
  });

  it("passes optional vars through", () => {
    const config = validateConfig({
      ...validEnv,
      DEVELOPMENT_GUILD_ID: "guild-123",
      DISCORD_CLIENT_ID: "client-456",
    });

    expect(config.DEVELOPMENT_GUILD_ID).toBe("guild-123");
    expect(config.DISCORD_CLIENT_ID).toBe("client-456");
  });

  it("defaults FILTER_REACTION_THRESHOLD to 3", () => {
    const config = validateConfig(validEnv);

    expect(config.FILTER_REACTION_THRESHOLD).toBe(3);
  });

  it("coerces FILTER_REACTION_THRESHOLD from string to number", () => {
    const config = validateConfig({
      ...validEnv,
      FILTER_REACTION_THRESHOLD: "5",
    });

    expect(config.FILTER_REACTION_THRESHOLD).toBe(5);
  });

  it("rejects a FILTER_REACTION_THRESHOLD below 1", () => {
    expect(() =>
      validateConfig({ ...validEnv, FILTER_REACTION_THRESHOLD: "0" }),
    ).toThrow("FILTER_REACTION_THRESHOLD");
  });
});
