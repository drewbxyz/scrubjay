import { describe, expect, it } from "vitest";
import { buildLoggerParams } from "./logging.config";

type PinoHttpShape = { autoLogging: boolean; level: string };

describe("buildLoggerParams", () => {
  it("defaults to info level with request auto-logging off", () => {
    const { pinoHttp } = buildLoggerParams({}) as { pinoHttp: PinoHttpShape };

    expect(pinoHttp.autoLogging).toBe(false);
    expect(pinoHttp.level).toBe("info");
  });

  it("honors LOG_LEVEL", () => {
    const { pinoHttp } = buildLoggerParams({ LOG_LEVEL: "debug" }) as {
      pinoHttp: PinoHttpShape;
    };

    expect(pinoHttp.level).toBe("debug");
  });

  it("falls back to info when LOG_LEVEL is empty", () => {
    const { pinoHttp } = buildLoggerParams({ LOG_LEVEL: "" }) as {
      pinoHttp: PinoHttpShape;
    };

    expect(pinoHttp.level).toBe("info");
  });

  it("lowercases a non-lowercase LOG_LEVEL", () => {
    const { pinoHttp } = buildLoggerParams({ LOG_LEVEL: "DEBUG" }) as {
      pinoHttp: PinoHttpShape;
    };

    expect(pinoHttp.level).toBe("debug");
  });

  it("falls back to info when LOG_LEVEL is not a pino level", () => {
    const { pinoHttp } = buildLoggerParams({ LOG_LEVEL: "nonsense" }) as {
      pinoHttp: PinoHttpShape;
    };

    expect(pinoHttp.level).toBe("info");
  });
});
