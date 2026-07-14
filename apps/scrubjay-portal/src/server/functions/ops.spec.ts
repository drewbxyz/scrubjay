import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

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

function stubFetch(status: number, body: unknown) {
  return vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(new Response(JSON.stringify(body), { status }));
}

// Import lazily, after env is stubbed once: "./ops" transitively imports
// auth.ts, which reads env() eagerly at module load. env() caches its
// result for the module's lifetime (see src/server/env.ts), so a static
// top-level import would freeze BOT_API_URL etc. to vitest.config's
// placeholder defaults before any per-test vi.stubEnv ever runs. Matches the
// pattern in bot-api.spec.ts and subscriptions.spec.ts.
let fetchBotHealthImpl: typeof import("./ops").fetchBotHealthImpl;
let listDeliveriesImpl: typeof import("./ops").listDeliveriesImpl;
let listObservationsImpl: typeof import("./ops").listObservationsImpl;

beforeAll(async () => {
  for (const [key, value] of Object.entries(TEST_ENV)) vi.stubEnv(key, value);
  ({ fetchBotHealthImpl, listDeliveriesImpl, listObservationsImpl } =
    await import("./ops"));
});

beforeEach(() => {
  for (const [key, value] of Object.entries(TEST_ENV)) vi.stubEnv(key, value);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("ops impls", () => {
  it("passes observation filters and pagination through the query string", async () => {
    const spy = stubFetch(200, { hasMore: false, observations: [] });
    await listObservationsImpl({ limit: 50, offset: 100, stateCode: "US-CA" });
    expect(String(spy.mock.calls[0]?.[0])).toBe(
      "http://bot.internal:3000/api/v1/observations?limit=50&offset=100&stateCode=US-CA",
    );
  });

  it("passes delivery filters through", async () => {
    const spy = stubFetch(200, { deliveries: [], hasMore: true });
    const result = await listDeliveriesImpl({
      limit: 50,
      offset: 0,
      status: "failed",
    });
    expect(result.hasMore).toBe(true);
    expect(String(spy.mock.calls[0]?.[0])).toContain("status=failed");
  });

  it("reports bot health from /health outside the API envelope", async () => {
    const spy = stubFetch(200, { details: {}, status: "ok" });
    const result = await fetchBotHealthImpl();
    expect(result).toEqual({ ok: true, status: "ok" });
    expect(String(spy.mock.calls[0]?.[0])).toBe(
      "http://bot.internal:3000/health",
    );
  });

  it("reports unhealthy on a non-2xx health response", async () => {
    stubFetch(503, { status: "error" });
    await expect(fetchBotHealthImpl()).resolves.toEqual({
      ok: false,
      status: "error",
    });
  });
});
