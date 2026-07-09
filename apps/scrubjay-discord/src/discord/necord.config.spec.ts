import { createNecordOptions } from "./necord.config";

describe("createNecordOptions", () => {
  it("registers commands to the development guild when the id is set", () => {
    const options = createNecordOptions({
      DEVELOPMENT_GUILD_ID: "guild-123",
      DISCORD_TOKEN: "token",
    });

    expect(options.development).toEqual(["guild-123"]);
    expect(options.token).toBe("token");
  });

  it("is explicitly false — never undefined — when the guild id is unset", () => {
    const options = createNecordOptions({
      DEVELOPMENT_GUILD_ID: undefined,
      DISCORD_TOKEN: "token",
    });

    // Necord's `development` expects Snowflake[] | false; `undefined`
    // is what risked global slash-command registration (bug B4).
    expect(options.development).toBe(false);
  });
});
