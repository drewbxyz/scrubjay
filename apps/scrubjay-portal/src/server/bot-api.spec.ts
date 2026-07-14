import { metrics } from "@opentelemetry/api";
import {
  AggregationTemporality,
  InMemoryMetricExporter,
  MeterProvider,
  PeriodicExportingMetricReader,
} from "@opentelemetry/sdk-metrics";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { z } from "zod";

const exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
const reader = new PeriodicExportingMetricReader({
  exporter,
  exportIntervalMillis: 60_000,
});

const TEST_ENV = {
  BETTER_AUTH_SECRET: "s".repeat(32),
  BETTER_AUTH_URL: "http://localhost:3100",
  BOT_API_URL: "http://bot.internal:3000",
  DATABASE_URL: "postgresql://u:p@localhost:5432/db",
  DISCORD_CLIENT_ID: "abc",
  DISCORD_CLIENT_SECRET: "def",
  PORTAL_OPERATOR_IDS: "123456789012345678",
  SCRUBJAY_API_TOKEN: "t".repeat(32),
};

const okSchema = z.object({ guilds: z.array(z.object({ id: z.string() })) });

// Import lazily so the global meter provider is registered first.
let botApi: typeof import("./bot-api").botApi;
let BotApiError: typeof import("./bot-api").BotApiError;
let toQuery: typeof import("./bot-api").toQuery;

beforeAll(async () => {
  metrics.setGlobalMeterProvider(new MeterProvider({ readers: [reader] }));
  ({ botApi, BotApiError, toQuery } = await import("./bot-api"));
});

beforeEach(() => {
  for (const [key, value] of Object.entries(TEST_ENV)) vi.stubEnv(key, value);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("botApi", () => {
  it("sends the bearer token and parses a valid response", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ guilds: [{ id: "1" }] }), {
        status: 200,
      }),
    );
    const result = await botApi(okSchema, {
      endpoint: "guilds.list",
      path: "/api/v1/guilds",
    });
    expect(result.guilds).toHaveLength(1);
    const [url, init] = fetchSpy.mock.calls[0] ?? [];
    expect(String(url)).toBe("http://bot.internal:3000/api/v1/guilds");
    expect(new Headers(init?.headers).get("authorization")).toBe(
      `Bearer ${"t".repeat(32)}`,
    );
  });

  it("maps the bot error envelope to BotApiError", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          error: { code: "NOT_FOUND", message: "no such subscription" },
        }),
        { status: 404 },
      ),
    );
    const err = await botApi(okSchema, {
      endpoint: "x",
      path: "/api/v1/x",
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BotApiError);
    expect(err).toMatchObject({ code: "NOT_FOUND", status: 404 });
  });

  it("flags contract mismatches", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ wrong: true }), { status: 200 }),
    );
    await expect(
      botApi(okSchema, { endpoint: "x", path: "/api/v1/x" }),
    ).rejects.toMatchObject({ code: "CONTRACT_MISMATCH", status: 502 });
  });

  it("maps a malformed 2xx body to CONTRACT_MISMATCH", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("not json", { status: 200 }),
    );
    const err = await botApi(okSchema, {
      endpoint: "x",
      path: "/api/v1/x",
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BotApiError);
    expect(err).toMatchObject({ code: "CONTRACT_MISMATCH", status: 502 });
  });

  it("maps network failures to BOT_UNREACHABLE", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(
      new TypeError("fetch failed"),
    );
    await expect(
      botApi(okSchema, { endpoint: "x", path: "/api/v1/x" }),
    ).rejects.toMatchObject({ code: "BOT_UNREACHABLE", status: 502 });
  });

  it("records request count and duration with logical-endpoint attributes", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ guilds: [] }), { status: 200 }),
    );
    await botApi(okSchema, { endpoint: "guilds.list", path: "/api/v1/guilds" });
    await reader.forceFlush();
    const names = exporter
      .getMetrics()
      .flatMap((rm) => rm.scopeMetrics)
      .flatMap((sm) => sm.metrics)
      .map((m) => m.descriptor.name);
    expect(names).toContain("scrubjay_portal_bot_api_requests");
    expect(names).toContain("scrubjay_portal_bot_api_duration");
  });
});

describe("toQuery", () => {
  it("builds an encoded query string and drops undefined", () => {
    expect(toQuery({ a: "x y", b: undefined, c: 5 })).toBe("?a=x+y&c=5");
    expect(toQuery({})).toBe("");
  });
});
