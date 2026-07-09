import type { SlashCommandContext } from "necord";
import type { SubscribeEBirdOptions } from "../options/subscribe-ebird.options";
import { SubscriptionsCommands } from "../subscriptions.commands";
import type { SubscriptionsService } from "../subscriptions.service";

describe("SubscriptionsCommands", () => {
  let commands: SubscriptionsCommands;

  const serviceMock = { subscribeToEBird: jest.fn() };
  const interaction = {
    channelId: "CH1",
    deferReply: jest.fn(),
    editReply: jest.fn(),
  };

  const run = (region: string) =>
    commands.onSubscribeEBird(
      [interaction] as unknown as SlashCommandContext,
      { region } as SubscribeEBirdOptions,
    );

  beforeEach(() => {
    jest.clearAllMocks();
    commands = new SubscriptionsCommands(
      serviceMock as unknown as SubscriptionsService,
    );
  });

  it("defers the reply before doing subscription work", async () => {
    const order: string[] = [];
    interaction.deferReply.mockImplementation(async () => {
      order.push("defer");
    });
    serviceMock.subscribeToEBird.mockImplementation(async () => {
      order.push("subscribe");
    });

    await run("US-WA");

    expect(order).toEqual(["defer", "subscribe"]);
  });

  it("confirms a successful subscription via editReply", async () => {
    serviceMock.subscribeToEBird.mockResolvedValue(undefined);

    await run("US-WA");

    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: "Subscribed to eBird observations for US-WA.",
      }),
    );
  });

  it("lets errors propagate to the exception filter", async () => {
    serviceMock.subscribeToEBird.mockRejectedValue(new Error("boom"));

    await expect(run("US-WA")).rejects.toThrow("boom");
    expect(interaction.editReply).not.toHaveBeenCalled();
  });
});
