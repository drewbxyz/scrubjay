import { Logger } from "@nestjs/common";
import type { ReactionRouter } from "../../reaction-router/reaction-router.service";
import { ReactionListenerService } from "../reaction-listener.service";

describe("ReactionListenerService", () => {
  let service: ReactionListenerService;

  const routerMock = { route: jest.fn() };
  const fullReaction = { partial: false };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Logger.prototype, "error").mockImplementation();
    routerMock.route.mockResolvedValue(undefined);
    service = new ReactionListenerService(
      routerMock as unknown as ReactionRouter,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("fetches a partial user before reading bot (B9)", async () => {
    const fetchedUser = { bot: false, partial: false };
    const partialUser = {
      bot: null,
      fetch: jest.fn().mockResolvedValue(fetchedUser),
      partial: true,
    };

    // biome-ignore lint/suspicious/noExplicitAny: stubbed discord.js payload
    await service.onReactionAdd([fullReaction, partialUser] as any);

    expect(partialUser.fetch).toHaveBeenCalled();
    expect(routerMock.route).toHaveBeenCalledWith({
      reaction: fullReaction,
      user: fetchedUser,
    });
  });

  it("ignores a bot user discovered after fetching (B9)", async () => {
    const partialBot = {
      bot: null,
      fetch: jest.fn().mockResolvedValue({ bot: true, partial: false }),
      partial: true,
    };

    // biome-ignore lint/suspicious/noExplicitAny: stubbed discord.js payload
    await service.onReactionAdd([fullReaction, partialBot] as any);

    expect(routerMock.route).not.toHaveBeenCalled();
  });

  it("bails out when the user fetch fails", async () => {
    const partialUser = {
      bot: null,
      fetch: jest.fn().mockRejectedValue(new Error("unknown user")),
      partial: true,
    };

    // biome-ignore lint/suspicious/noExplicitAny: stubbed discord.js payload
    await service.onReactionAdd([fullReaction, partialUser] as any);

    expect(routerMock.route).not.toHaveBeenCalled();
  });

  it("still ignores plain bot users", async () => {
    const plainBot = { bot: true, partial: false };

    // biome-ignore lint/suspicious/noExplicitAny: stubbed discord.js payload
    await service.onReactionAdd([fullReaction, plainBot] as any);

    expect(routerMock.route).not.toHaveBeenCalled();
  });
});
