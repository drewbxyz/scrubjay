import { DiscordAPIError } from "discord.js";
import { describe, expect, it } from "vitest";
import { classifySendError } from "./discord-error";

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

describe("classifySendError", () => {
  it("classifies Unknown Channel as permanent and gone", () => {
    expect(classifySendError(apiError(10003))).toEqual({
      channelGone: true,
      code: 10003,
      kind: "permanent",
    });
  });

  it("classifies Missing Access and Missing Permissions as permanent, not gone", () => {
    expect(classifySendError(apiError(50001))).toEqual({
      channelGone: false,
      code: 50001,
      kind: "permanent",
    });
    expect(classifySendError(apiError(50013))).toEqual({
      channelGone: false,
      code: 50013,
      kind: "permanent",
    });
  });

  it("classifies other Discord errors and non-Discord errors as transient", () => {
    expect(classifySendError(apiError(500))).toEqual({ kind: "transient" });
    expect(classifySendError(new Error("socket hang up"))).toEqual({
      kind: "transient",
    });
  });
});
