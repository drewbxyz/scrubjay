import type { SlashCommandContext } from "necord";
import type { SubscriptionsService } from "@/features/subscriptions/subscriptions.service";
import type { SubscribeEBirdCommandDto } from "../commands.dto";
import { SubscriptionCommands } from "../subscription-commands.service";

describe("SubscriptionCommands", () => {
  let commands: SubscriptionCommands;

  const serviceMock = { subscribeToEBird: jest.fn() };
  const interaction = { channelId: "CH1", reply: jest.fn() };

  const run = (region: string) =>
    commands.onSubscribeEBird(
      [interaction] as unknown as SlashCommandContext,
      { region } as SubscribeEBirdCommandDto,
    );

  beforeEach(() => {
    jest.clearAllMocks();
    commands = new SubscriptionCommands(
      serviceMock as unknown as SubscriptionsService,
    );
  });

  it("confirms a successful subscription", async () => {
    serviceMock.subscribeToEBird.mockResolvedValue(undefined);

    await run("US-WA");

    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: "Subscribed to eBird observations for US-WA.",
      }),
    );
  });

  it("shows the invalid-region message verbatim", async () => {
    serviceMock.subscribeToEBird.mockRejectedValue(
      new Error("Invalid region code: US"),
    );

    await run("US");

    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: "Invalid region code: US" }),
    );
  });

  it("hides internal errors behind a generic message (B10)", async () => {
    serviceMock.subscribeToEBird.mockRejectedValue(
      new Error("Failed to subscribe to eBird: Error: connection refused"),
    );

    await run("US-WA");

    const { content } = (interaction.reply as jest.Mock).mock.calls[0][0];
    expect(content).toBe("Something went wrong subscribing this channel.");
    expect(content).not.toContain("connection refused");
  });
});
