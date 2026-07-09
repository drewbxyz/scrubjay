import { Logger } from "@nestjs/common";
import type { MessageSenderService } from "@/discord/message-sender.service";
import type { AlertQueue, PendingEBirdAlert } from "./alert-queue.service";
import { DispatchService } from "./dispatch.service";

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

  const alertQueueMock = { markSent: jest.fn(), pendingEBirdAlerts: jest.fn() };
  const senderMock = { send: jest.fn() };

  const since = new Date("2026-07-08T00:00:00Z");

  beforeEach(() => {
    jest.spyOn(Logger.prototype, "debug").mockImplementation();
    jest.spyOn(Logger.prototype, "error").mockImplementation();
    jest.spyOn(Logger.prototype, "log").mockImplementation();

    alertQueueMock.pendingEBirdAlerts.mockReset().mockResolvedValue([]);
    alertQueueMock.markSent.mockReset().mockResolvedValue(undefined);
    senderMock.send.mockReset().mockResolvedValue(undefined);

    service = new DispatchService(
      alertQueueMock as unknown as AlertQueue,
      senderMock as unknown as MessageSenderService,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("asks the queue for alerts pending since the cutoff", async () => {
    await service.dispatchSince(since);

    expect(alertQueueMock.pendingEBirdAlerts).toHaveBeenCalledWith(since);
  });

  it("does not send or record when nothing is pending", async () => {
    await service.dispatchSince(since);

    expect(senderMock.send).not.toHaveBeenCalled();
    expect(alertQueueMock.markSent).not.toHaveBeenCalled();
  });

  it("sends one message per plan and records every sent alert", async () => {
    alertQueueMock.pendingEBirdAlerts.mockResolvedValue([
      makeAlert({ subId: "S001" }),
      makeAlert({ subId: "S002" }), // same group
      makeAlert({ channelId: "CH2", subId: "S001" }),
    ]);

    await service.dispatchSince(since);

    expect(senderMock.send).toHaveBeenCalledTimes(2);
    expect(alertQueueMock.markSent).toHaveBeenCalledTimes(1);
    expect(alertQueueMock.markSent).toHaveBeenCalledWith([
      { channelId: "CH1", speciesCode: "verfly", subId: "S001" },
      { channelId: "CH1", speciesCode: "verfly", subId: "S002" },
      { channelId: "CH2", speciesCode: "verfly", subId: "S001" },
    ]);
  });

  it("leaves alerts pending when their send fails, still recording the rest", async () => {
    alertQueueMock.pendingEBirdAlerts.mockResolvedValue([
      makeAlert({ channelId: "CH1" }),
      makeAlert({ channelId: "CH2" }),
    ]);
    senderMock.send.mockRejectedValueOnce(new Error("channel gone")); // CH1

    await service.dispatchSince(since);

    expect(alertQueueMock.markSent).toHaveBeenCalledWith([
      { channelId: "CH2", speciesCode: "verfly", subId: "S001" },
    ]);
  });
});
