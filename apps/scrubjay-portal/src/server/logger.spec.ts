import { afterEach, describe, expect, it, vi } from "vitest";
import { logger } from "./logger";

describe("logger", () => {
  afterEach(() => vi.restoreAllMocks());

  it("writes a JSON line with level, msg and attributes to stdout", () => {
    const write = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    logger.info("portal started", { port: 3100 });
    expect(write).toHaveBeenCalledTimes(1);
    const line = JSON.parse(String(write.mock.calls[0]?.[0]));
    expect(line).toMatchObject({
      level: "info",
      msg: "portal started",
      port: 3100,
    });
    expect(typeof line.time).toBe("string");
  });

  it("routes errors to stderr", () => {
    const write = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    logger.error("boom", { reason: "test" });
    const line = JSON.parse(String(write.mock.calls[0]?.[0]));
    expect(line).toMatchObject({ level: "error", msg: "boom", reason: "test" });
  });
});
