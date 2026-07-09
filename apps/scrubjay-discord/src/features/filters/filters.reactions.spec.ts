import { Logger } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import { FiltersReactions } from "./filters.reactions";
import type { FiltersRepository } from "./filters.repository";

describe("FiltersReactions", () => {
  let reactions: FiltersReactions;

  const repoMock = {
    addChannelFilter: jest.fn(),
    isChannelFilterable: jest.fn(),
  };
  const configMock = { get: jest.fn() };

  const fullUser = { bot: false, partial: false };

  const makeReaction = (overrides: Record<string, unknown> = {}) => ({
    count: 3,
    emoji: { name: "👎" },
    message: {
      channelId: "channel-1",
      embeds: [{ title: "Snowy Owl - King County" }],
    },
    partial: false,
    ...overrides,
  });

  // biome-ignore lint/suspicious/noExplicitAny: stubbed discord.js payload
  const run = (reaction: any, user: any = fullUser) =>
    reactions.onReactionAdd([reaction, user] as never);

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Logger.prototype, "debug").mockImplementation();
    jest.spyOn(Logger.prototype, "error").mockImplementation();
    jest.spyOn(Logger.prototype, "log").mockImplementation();
    configMock.get.mockReturnValue(3);
    repoMock.isChannelFilterable.mockResolvedValue(true);
    repoMock.addChannelFilter.mockResolvedValue([]);
    reactions = new FiltersReactions(
      repoMock as unknown as FiltersRepository,
      configMock as unknown as ConfigService<never, true>,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("adds a filter when the channel is filterable and an embed title exists", async () => {
    await run(makeReaction());

    expect(repoMock.addChannelFilter).toHaveBeenCalledWith(
      "channel-1",
      "Snowy Owl",
    );
  });

  it("fetches a partial user before reading bot (B9)", async () => {
    const partialUser = {
      bot: null,
      fetch: jest.fn().mockResolvedValue({ bot: false, partial: false }),
      partial: true,
    };

    await run(makeReaction(), partialUser);

    expect(partialUser.fetch).toHaveBeenCalled();
    expect(repoMock.addChannelFilter).toHaveBeenCalledWith(
      "channel-1",
      "Snowy Owl",
    );
  });

  it("ignores a bot user discovered after fetching (B9)", async () => {
    const partialBot = {
      bot: null,
      fetch: jest.fn().mockResolvedValue({ bot: true, partial: false }),
      partial: true,
    };

    await run(makeReaction(), partialBot);

    expect(repoMock.isChannelFilterable).not.toHaveBeenCalled();
    expect(repoMock.addChannelFilter).not.toHaveBeenCalled();
  });

  it("bails out when the user fetch fails", async () => {
    const partialUser = {
      bot: null,
      fetch: jest.fn().mockRejectedValue(new Error("unknown user")),
      partial: true,
    };

    await run(makeReaction(), partialUser);

    expect(repoMock.addChannelFilter).not.toHaveBeenCalled();
  });

  it("still ignores plain bot users", async () => {
    await run(makeReaction(), { bot: true, partial: false });

    expect(repoMock.addChannelFilter).not.toHaveBeenCalled();
  });

  it("fetches a partial reaction before reading it", async () => {
    const partialReaction = {
      fetch: jest.fn().mockResolvedValue(makeReaction()),
      partial: true,
    };

    await run(partialReaction);

    expect(partialReaction.fetch).toHaveBeenCalled();
    expect(repoMock.addChannelFilter).toHaveBeenCalledWith(
      "channel-1",
      "Snowy Owl",
    );
  });

  it("bails out when the reaction fetch fails", async () => {
    const partialReaction = {
      fetch: jest.fn().mockRejectedValue(new Error("unknown message")),
      partial: true,
    };

    await run(partialReaction);

    expect(repoMock.addChannelFilter).not.toHaveBeenCalled();
  });

  it("ignores reactions with other emoji", async () => {
    await run(makeReaction({ emoji: { name: "👍" } }));

    expect(repoMock.isChannelFilterable).not.toHaveBeenCalled();
    expect(repoMock.addChannelFilter).not.toHaveBeenCalled();
  });

  it("ignores reactions below the threshold", async () => {
    await run(makeReaction({ count: 2 }));

    expect(repoMock.addChannelFilter).not.toHaveBeenCalled();
  });

  it("reads the threshold from config", async () => {
    configMock.get.mockReturnValue(5);

    await run(makeReaction({ count: 4 }));
    expect(repoMock.addChannelFilter).not.toHaveBeenCalled();

    await run(makeReaction({ count: 5 }));
    expect(repoMock.addChannelFilter).toHaveBeenCalledWith(
      "channel-1",
      "Snowy Owl",
    );
    expect(configMock.get).toHaveBeenCalledWith("FILTER_REACTION_THRESHOLD", {
      infer: true,
    });
  });

  it("does not add a filter when the channel is not filterable", async () => {
    repoMock.isChannelFilterable.mockResolvedValue(false);

    await run(makeReaction());

    expect(repoMock.addChannelFilter).not.toHaveBeenCalled();
  });

  it("does nothing when the message has no embed title", async () => {
    await run(
      makeReaction({ message: { channelId: "channel-1", embeds: [] } }),
    );

    expect(repoMock.addChannelFilter).not.toHaveBeenCalled();
  });

  it("parses species names containing ' - ' fully (B2)", async () => {
    await run(
      makeReaction({
        message: {
          channelId: "channel-1",
          embeds: [{ title: "Northern Goshawk - dark morph - King County" }],
        },
      }),
    );

    expect(repoMock.addChannelFilter).toHaveBeenCalledWith(
      "channel-1",
      "Northern Goshawk - dark morph",
    );
  });

  it("falls back to the whole title when there is no separator", async () => {
    await run(
      makeReaction({
        message: { channelId: "channel-1", embeds: [{ title: "Snowy Owl" }] },
      }),
    );

    expect(repoMock.addChannelFilter).toHaveBeenCalledWith(
      "channel-1",
      "Snowy Owl",
    );
  });

  it("swallows repository insert failures", async () => {
    repoMock.addChannelFilter.mockRejectedValue(new Error("db down"));

    await expect(run(makeReaction())).resolves.toBeUndefined();
  });

  it("swallows isChannelFilterable rejections without adding a filter", async () => {
    repoMock.isChannelFilterable.mockRejectedValue(new Error("db down"));

    await expect(run(makeReaction())).resolves.toBeUndefined();

    expect(repoMock.addChannelFilter).not.toHaveBeenCalled();
    expect(Logger.prototype.error).toHaveBeenCalled();
  });
});
