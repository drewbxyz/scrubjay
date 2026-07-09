import type { ArgumentsHost } from "@nestjs/common";
import { Logger } from "@nestjs/common";
import { InvalidRegionError } from "@/features/subscriptions/invalid-region.error";
import { CommandExceptionFilter } from "../command-exception.filter";

describe("CommandExceptionFilter", () => {
  let filter: CommandExceptionFilter;
  let loggerErrorSpy: jest.SpyInstance;

  const interaction = {
    deferred: false,
    editReply: jest.fn(),
    replied: false,
    reply: jest.fn(),
  };

  const host = {
    getArgs: () => [[interaction]],
    getType: () => "necord",
  } as unknown as ArgumentsHost;

  beforeEach(() => {
    jest.clearAllMocks();
    interaction.deferred = false;
    interaction.replied = false;
    loggerErrorSpy = jest.spyOn(Logger.prototype, "error").mockImplementation();
    filter = new CommandExceptionFilter();
  });

  afterEach(() => {
    loggerErrorSpy.mockRestore();
  });

  it("passes an InvalidRegionError message through verbatim", async () => {
    await filter.catch(new InvalidRegionError("US"), host);

    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: "Invalid region code: US" }),
    );
  });

  it("hides other errors behind a generic message", async () => {
    await filter.catch(new Error("connection refused"), host);

    const { content } = (interaction.reply as jest.Mock).mock.calls[0][0];
    expect(content).toBe("Something went wrong running that command.");
    expect(content).not.toContain("connection refused");
  });

  it("uses editReply when the interaction was already deferred", async () => {
    interaction.deferred = true;

    await filter.catch(new Error("boom"), host);

    expect(interaction.editReply).toHaveBeenCalledWith({
      content: "Something went wrong running that command.",
    });
    expect(interaction.reply).not.toHaveBeenCalled();
  });

  it("logs the error with its stack", async () => {
    const err = new Error("boom");

    await filter.catch(err, host);

    expect(loggerErrorSpy).toHaveBeenCalledWith("boom", err.stack);
  });

  it("copes with non-Error thrown values", async () => {
    await filter.catch("string failure", host);

    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: "Something went wrong running that command.",
      }),
    );
  });
});
