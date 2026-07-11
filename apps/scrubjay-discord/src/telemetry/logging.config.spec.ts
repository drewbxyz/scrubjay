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
});
