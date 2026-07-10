import type { Client } from "discord.js";
import { DiscordAPIError } from "discord.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MessageSenderService } from "./message-sender.service";

describe("MessageSenderService", () => {
  let sender: MessageSenderService;

  const fetchMock = vi.fn();
  const clientMock = { channels: { fetch: fetchMock } } as unknown as Client;

  function apiError(code: number): DiscordAPIError {
    return new DiscordAPIError(
      { code, message: "boom" },
      code,
      404,
      "POST",
      "https://discord.com/api",
      { body: undefined, files: undefined },
    );
  }

  beforeEach(() => {
    vi.clearAllMocks();
    sender = new MessageSenderService(clientMock);
  });

  it("sends to a sendable channel", async () => {
    const send = vi.fn();
    fetchMock.mockResolvedValue({ isSendable: () => true, send });

    await sender.send("channel-1", { embeds: [] });

    expect(fetchMock).toHaveBeenCalledWith("channel-1");
    expect(send).toHaveBeenCalledWith({ embeds: [] });
  });

  it("throws when the channel does not exist", async () => {
    fetchMock.mockResolvedValue(null);

    await expect(sender.send("nope", "hi")).rejects.toThrow(
      "Channel nope not found or not sendable",
    );
  });

  it("throws when the channel is not sendable", async () => {
    const send = vi.fn();
    fetchMock.mockResolvedValue({ isSendable: () => false, send });

    await expect(sender.send("channel-1", "hi")).rejects.toThrow(
      "Channel channel-1 not found or not sendable",
    );
    expect(send).not.toHaveBeenCalled();
  });

  it("propagates a DiscordAPIError (Unknown Channel) so the classifier can see the code", async () => {
    const err = apiError(10003);
    fetchMock.mockRejectedValue(err);

    await expect(sender.send("gone", "hi")).rejects.toBe(err);
  });
});
