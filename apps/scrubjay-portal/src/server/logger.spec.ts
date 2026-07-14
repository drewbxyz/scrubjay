import { logs, SeverityNumber } from "@opentelemetry/api-logs";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

const stubLogger = { emit: vi.fn() };

// The global logger provider must be registered BEFORE logger.ts resolves its
// logger via logs.getLogger(...) at module load. api-logs' proxy provider
// otherwise permanently captures the noop provider for that logger instance.
logs.setGlobalLoggerProvider({
  getLogger: () => stubLogger,
} as unknown as Parameters<typeof logs.setGlobalLoggerProvider>[0]);

afterAll(() => {
  logs.disable();
});

const { logger } = await import("./logger");

describe("logger", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    stubLogger.emit.mockClear();
  });

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

  describe("OTel log emission", () => {
    it("emits an INFO severity log record for logger.info", () => {
      vi.spyOn(process.stdout, "write").mockReturnValue(true);
      logger.info("portal started", { port: 3100 });
      expect(stubLogger.emit).toHaveBeenCalledTimes(1);
      expect(stubLogger.emit).toHaveBeenCalledWith({
        attributes: { port: 3100 },
        body: "portal started",
        severityNumber: SeverityNumber.INFO,
        severityText: "INFO",
      });
    });

    it("emits a WARN severity log record for logger.warn", () => {
      vi.spyOn(process.stdout, "write").mockReturnValue(true);
      logger.warn("careful", { reason: "test" });
      expect(stubLogger.emit).toHaveBeenCalledTimes(1);
      expect(stubLogger.emit).toHaveBeenCalledWith({
        attributes: { reason: "test" },
        body: "careful",
        severityNumber: SeverityNumber.WARN,
        severityText: "WARN",
      });
    });

    it("emits an ERROR severity log record for logger.error", () => {
      vi.spyOn(process.stderr, "write").mockReturnValue(true);
      logger.error("boom", { reason: "test" });
      expect(stubLogger.emit).toHaveBeenCalledTimes(1);
      expect(stubLogger.emit).toHaveBeenCalledWith({
        attributes: { reason: "test" },
        body: "boom",
        severityNumber: SeverityNumber.ERROR,
        severityText: "ERROR",
      });
    });
  });
});
