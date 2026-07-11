import { MessageFlags } from "discord.js";
import type {
  ButtonContext,
  SlashCommandContext,
  StringSelectContext,
} from "necord";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SubscribeEBirdOptions } from "./options/subscribe-ebird.options";
import { SubscriptionsCommands } from "./subscriptions.commands";
import type { SubscriptionsService } from "./subscriptions.service";

describe("SubscriptionsCommands", () => {
  let commands: SubscriptionsCommands;

  const serviceMock = {
    listSubscriptions: vi.fn(),
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
  };
  const interaction = {
    channelId: "CH1",
    deferReply: vi.fn(),
    deferUpdate: vi.fn(),
    editReply: vi.fn(),
    // Component handlers re-check admin; default the mock to an admin caller.
    memberPermissions: { has: vi.fn(() => true) },
    reply: vi.fn(),
    update: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    interaction.memberPermissions.has.mockReturnValue(true);
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

  describe("onSubscriptionRemove", () => {
    const remove = (region: string) =>
      commands.onSubscriptionRemove(
        [interaction] as unknown as SlashCommandContext,
        { region } as SubscribeEBirdOptions,
      );

    it("defers the reply before doing subscription work", async () => {
      const order: string[] = [];
      interaction.deferReply.mockImplementation(async () => {
        order.push("defer");
      });
      serviceMock.unsubscribe.mockImplementation(async () => {
        order.push("unsubscribe");
        return true;
      });

      await remove("US-WA");

      expect(order).toEqual(["defer", "unsubscribe"]);
    });

    it("confirms removal via editReply", async () => {
      serviceMock.unsubscribe.mockResolvedValue(true);

      await remove("US-WA");

      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: "Unsubscribed to eBird observations for US-WA",
        }),
      );
    });

    it("reports when the channel was not subscribed", async () => {
      serviceMock.unsubscribe.mockResolvedValue(false);

      await remove("US-WA");

      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining("not subscribed"),
        }),
      );
    });
  });

  describe("onSubscriptionList", () => {
    const list = () =>
      commands.onSubscriptionList([
        interaction,
      ] as unknown as SlashCommandContext);

    it("defers ephemerally, then edits in the first page for the channel", async () => {
      serviceMock.listSubscriptions.mockResolvedValue([
        { countyCode: "US-WA-033", stateCode: "US-WA" },
      ]);

      await list();

      expect(interaction.deferReply).toHaveBeenCalledWith({
        flags: [MessageFlags.Ephemeral],
      });
      expect(serviceMock.listSubscriptions).toHaveBeenCalledWith("CH1");
      const payload = interaction.editReply.mock.calls[0][0];
      expect(payload.components).toHaveLength(1); // select row only (single page)
    });

    it("shows an empty state with no components when there are none", async () => {
      serviceMock.listSubscriptions.mockResolvedValue([]);

      await list();

      const payload = interaction.editReply.mock.calls[0][0];
      expect(payload.components).toEqual([]);
    });
  });

  describe("onSubscriptionListNav", () => {
    const nav = (page: string) =>
      commands.onSubscriptionListNav(
        [interaction] as unknown as ButtonContext,
        page,
      );

    it("re-renders the requested page in place", async () => {
      const subs = Array.from({ length: 15 }, (_, i) => ({
        countyCode: `US-WA-${String(i).padStart(3, "0")}`,
        stateCode: "US-WA",
      }));
      serviceMock.listSubscriptions.mockResolvedValue(subs);

      await nav("1");

      expect(serviceMock.listSubscriptions).toHaveBeenCalledWith("CH1");
      expect(interaction.update).toHaveBeenCalledTimes(1);
    });

    it("refuses a non-admin caller without touching the service", async () => {
      interaction.memberPermissions.has.mockReturnValue(false);

      await nav("1");

      expect(serviceMock.listSubscriptions).not.toHaveBeenCalled();
      expect(interaction.update).not.toHaveBeenCalled();
      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({ flags: [MessageFlags.Ephemeral] }),
      );
    });
  });

  describe("onSubscriptionListRemove", () => {
    const removeSelected = (page: string, region: string) =>
      commands.onSubscriptionListRemove(
        [interaction] as unknown as StringSelectContext,
        page,
        [region],
      );

    it("defers, unsubscribes the selected region, then re-renders the page", async () => {
      const order: string[] = [];
      interaction.deferUpdate.mockImplementation(async () => {
        order.push("defer");
      });
      serviceMock.unsubscribe.mockImplementation(async () => {
        order.push("unsubscribe");
        return true;
      });

      await removeSelected("0", "US-WA-033");

      expect(order).toEqual(["defer", "unsubscribe"]);
      expect(serviceMock.unsubscribe).toHaveBeenCalledWith("CH1", "US-WA-033");
      expect(interaction.editReply).toHaveBeenCalledTimes(1);
    });

    it("refuses a non-admin caller without unsubscribing", async () => {
      interaction.memberPermissions.has.mockReturnValue(false);

      await removeSelected("0", "US-WA-033");

      expect(serviceMock.unsubscribe).not.toHaveBeenCalled();
      expect(interaction.deferUpdate).not.toHaveBeenCalled();
      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({ flags: [MessageFlags.Ephemeral] }),
      );
    });
  });
});
