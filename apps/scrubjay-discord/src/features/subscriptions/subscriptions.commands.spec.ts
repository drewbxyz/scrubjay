import { MessageFlags } from "discord.js";
import type {
  ButtonContext,
  SlashCommandContext,
  StringSelectContext,
} from "necord";
import type { SubscribeEBirdOptions } from "./options/subscribe-ebird.options";
import { SubscriptionsCommands } from "./subscriptions.commands";
import type { SubscriptionsService } from "./subscriptions.service";

describe("SubscriptionsCommands", () => {
  let commands: SubscriptionsCommands;

  const serviceMock = {
    listSubscriptions: jest.fn(),
    subscribe: jest.fn(),
    unsubscribe: jest.fn(),
  };
  const interaction = {
    channelId: "CH1",
    deferReply: jest.fn(),
    deferUpdate: jest.fn(),
    editReply: jest.fn(),
    reply: jest.fn(),
    update: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    serviceMock.listSubscriptions.mockResolvedValue([]);
    commands = new SubscriptionsCommands(
      serviceMock as unknown as SubscriptionsService,
    );
  });

  describe("onSubscriptionAdd", () => {
    const add = (region: string) =>
      commands.onSubscriptionAdd(
        [interaction] as unknown as SlashCommandContext,
        { region } as SubscribeEBirdOptions,
      );

    it("defers the reply before doing subscription work", async () => {
      const order: string[] = [];
      interaction.deferReply.mockImplementation(async () => {
        order.push("defer");
      });
      serviceMock.subscribe.mockImplementation(async () => {
        order.push("subscribe");
        return true;
      });

      await add("US-WA");

      expect(order).toEqual(["defer", "subscribe"]);
    });

    it("confirms a new subscription via editReply", async () => {
      serviceMock.subscribe.mockResolvedValue(true);

      await add("US-WA");

      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: "Subscribed to eBird observations for US-WA.",
        }),
      );
    });

    it("reports an existing subscription when nothing new was added", async () => {
      serviceMock.subscribe.mockResolvedValue(false);

      await add("US-WA");

      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining("already subscribed"),
        }),
      );
    });

    it("lets errors propagate to the exception filter", async () => {
      serviceMock.subscribe.mockRejectedValue(new Error("boom"));

      await expect(add("US-WA")).rejects.toThrow("boom");
      expect(interaction.editReply).not.toHaveBeenCalled();
    });
  });

  describe("onSubscriptionList", () => {
    const list = () =>
      commands.onSubscriptionList([
        interaction,
      ] as unknown as SlashCommandContext);

    it("replies ephemerally with the first page for the channel", async () => {
      serviceMock.listSubscriptions.mockResolvedValue([
        { countyCode: "US-WA-033", stateCode: "US-WA" },
      ]);

      await list();

      expect(serviceMock.listSubscriptions).toHaveBeenCalledWith("CH1");
      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({ flags: [MessageFlags.Ephemeral] }),
      );
      const payload = interaction.reply.mock.calls[0][0];
      expect(payload.components).toHaveLength(1); // select row only (single page)
    });

    it("shows an empty state with no components when there are none", async () => {
      serviceMock.listSubscriptions.mockResolvedValue([]);

      await list();

      const payload = interaction.reply.mock.calls[0][0];
      expect(payload.components).toEqual([]);
    });
  });

  describe("onSubscriptionListNav", () => {
    it("re-renders the requested page in place", async () => {
      const subs = Array.from({ length: 15 }, (_, i) => ({
        countyCode: `US-WA-${String(i).padStart(3, "0")}`,
        stateCode: "US-WA",
      }));
      serviceMock.listSubscriptions.mockResolvedValue(subs);

      await commands.onSubscriptionListNav(
        [interaction] as unknown as ButtonContext,
        "1",
      );

      expect(serviceMock.listSubscriptions).toHaveBeenCalledWith("CH1");
      expect(interaction.update).toHaveBeenCalledTimes(1);
    });
  });

  describe("onSubscriptionListRemove", () => {
    it("defers, unsubscribes the selected region, then re-renders the page", async () => {
      const order: string[] = [];
      interaction.deferUpdate.mockImplementation(async () => {
        order.push("defer");
      });
      serviceMock.unsubscribe.mockImplementation(async () => {
        order.push("unsubscribe");
        return true;
      });

      await commands.onSubscriptionListRemove(
        [interaction] as unknown as StringSelectContext,
        "0",
        ["US-WA-033"],
      );

      expect(order).toEqual(["defer", "unsubscribe"]);
      expect(serviceMock.unsubscribe).toHaveBeenCalledWith("CH1", "US-WA-033");
      expect(interaction.editReply).toHaveBeenCalledTimes(1);
    });
  });
});
