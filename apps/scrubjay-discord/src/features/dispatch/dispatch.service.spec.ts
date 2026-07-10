import { Logger } from "@nestjs/common";
import { DiscordAPIError } from "discord.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MessageSenderService } from "@/discord/message-sender.service";
import type { AlertQueue, PendingEBirdAlert } from "./alert-queue.service";
import { DispatchService } from "./dispatch.service";

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

function makeAlert(
  overrides: Partial<PendingEBirdAlert> = {},
): PendingEBirdAlert {
  return {
    audioCount: 0,
    channelId: "CH1",
    comName: "Vermilion Flycatcher",
    county: "Santa Clara",
    createdAt: new Date("2026-07-07T12:00:00Z"),
    howMany: 1,
    isPrivate: false,
    locationName: "Test Hotspot",
    locId: "L001",
    obsDt: new Date("2026-07-07T09:00:00Z"),
    photoCount: 0,
    recentlyConfirmed: false,
    sciName: "Pyrocephalus rubinus",
    speciesCode: "verfly",
    state: "California",
    subId: "S001",
    videoCount: 0,
    ...overrides,
  };
}

describe("DispatchService", () => {
  let service: DispatchService;

  const alertQueueMock = {
    deactivateChannel: vi.fn(),
    pendingEBirdAlerts: vi.fn(),
    record: vi.fn(),
  };
  const senderMock = { send: vi.fn() };

  const since = new Date("2026-07-08T00:00:00Z");

  beforeEach(() => {
    vi.spyOn(Logger.prototype, "debug").mockImplementation(() => {});
    vi.spyOn(Logger.prototype, "error").mockImplementation(() => {});
    vi.spyOn(Logger.prototype, "log").mockImplementation(() => {});

    alertQueueMock.deactivateChannel.mockReset().mockResolvedValue(1);
    alertQueueMock.pendingEBirdAlerts.mockReset().mockResolvedValue([]);
    alertQueueMock.record.mockReset().mockResolvedValue(undefined);
    senderMock.send.mockReset().mockResolvedValue(undefined);

    service = new DispatchService(
      alertQueueMock as unknown as AlertQueue,
      senderMock as unknown as MessageSenderService,
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("asks the queue for alerts pending since the cutoff", async () => {
    await service.dispatchSince(since);

    expect(alertQueueMock.pendingEBirdAlerts).toHaveBeenCalledWith(since);
  });

  it("does not send or record when nothing is pending", async () => {
    await service.dispatchSince(since);

    expect(senderMock.send).not.toHaveBeenCalled();
    expect(alertQueueMock.record).not.toHaveBeenCalled();
  });

  it("sends one message per plan and records every sent alert", async () => {
    alertQueueMock.pendingEBirdAlerts.mockResolvedValue([
      makeAlert({ subId: "S001" }),
      makeAlert({ subId: "S002" }), // same group
      makeAlert({ channelId: "CH2", subId: "S001" }),
    ]);

    await service.dispatchSince(since);

    expect(senderMock.send).toHaveBeenCalledTimes(2);
    expect(alertQueueMock.record).toHaveBeenCalledTimes(2);
    expect(alertQueueMock.record).toHaveBeenNthCalledWith(
      1,
      [
        { channelId: "CH1", speciesCode: "verfly", subId: "S001" },
        { channelId: "CH1", speciesCode: "verfly", subId: "S002" },
      ],
      "sent",
    );
    expect(alertQueueMock.record).toHaveBeenNthCalledWith(
      2,
      [{ channelId: "CH2", speciesCode: "verfly", subId: "S001" }],
      "sent",
    );
  });

  it("leaves alerts pending when their send fails, still recording the rest", async () => {
    alertQueueMock.pendingEBirdAlerts.mockResolvedValue([
      makeAlert({ channelId: "CH1" }),
      makeAlert({ channelId: "CH2" }),
    ]);
    senderMock.send.mockRejectedValueOnce(new Error("channel gone")); // CH1

    await service.dispatchSince(since);

    expect(alertQueueMock.record).toHaveBeenCalledTimes(1);
    expect(alertQueueMock.record).toHaveBeenCalledWith(
      [{ channelId: "CH2", speciesCode: "verfly", subId: "S001" }],
      "sent",
    );
  });

  it("records each plan immediately after its send (per-plan, not batched)", async () => {
    alertQueueMock.pendingEBirdAlerts.mockResolvedValue([
      makeAlert({ channelId: "CH1" }),
      makeAlert({ channelId: "CH2" }),
    ]);
    const calls: string[] = [];
    senderMock.send.mockImplementation(async (channelId: string) => {
      calls.push(`send:${channelId}`);
    });
    alertQueueMock.record.mockImplementation(async (alerts: unknown[]) => {
      calls.push(`record:${(alerts as { channelId: string }[])[0].channelId}`);
    });

    await service.dispatchSince(since);

    expect(calls).toEqual(["send:CH1", "record:CH1", "send:CH2", "record:CH2"]);
  });

  it("records a permanent permission failure as failed without deactivating", async () => {
    alertQueueMock.pendingEBirdAlerts.mockResolvedValue([makeAlert()]);
    senderMock.send.mockRejectedValue(apiError(50013));

    await service.dispatchSince(since);

    expect(alertQueueMock.record).toHaveBeenCalledWith(
      [{ channelId: "CH1", speciesCode: "verfly", subId: "S001" }],
      "failed",
      "discord:50013",
    );
    expect(alertQueueMock.deactivateChannel).not.toHaveBeenCalled();
  });

  it("deactivates the channel's subscriptions on Unknown Channel", async () => {
    alertQueueMock.pendingEBirdAlerts.mockResolvedValue([makeAlert()]);
    senderMock.send.mockRejectedValue(apiError(10003));

    await service.dispatchSince(since);

    expect(alertQueueMock.record).toHaveBeenCalledWith(
      [{ channelId: "CH1", speciesCode: "verfly", subId: "S001" }],
      "failed",
      "discord:10003",
    );
    expect(alertQueueMock.deactivateChannel).toHaveBeenCalledWith("CH1");
  });

  it("records nothing for transient failures so the alerts stay pending", async () => {
    alertQueueMock.pendingEBirdAlerts.mockResolvedValue([makeAlert()]);
    senderMock.send.mockRejectedValue(new Error("socket hang up"));

    await service.dispatchSince(since);

    expect(alertQueueMock.record).not.toHaveBeenCalled();
    expect(alertQueueMock.deactivateChannel).not.toHaveBeenCalled();
  });
});
