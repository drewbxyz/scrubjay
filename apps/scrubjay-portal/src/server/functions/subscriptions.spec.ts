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

const SUB = {
  active: true,
  channelId: "123456789012345678",
  countyCode: "US-CA-085",
  lastUpdated: "2026-07-13T00:00:00.000Z",
  stateCode: "US-CA",
};

function stubFetch(status: number, body: unknown) {
  return vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(new Response(JSON.stringify(body), { status }));
}

// Import lazily, after env is stubbed once: "./subscriptions" transitively
// imports auth.ts, which reads env() eagerly at module load. env() caches
// its result for the module's lifetime (see src/server/env.ts), so a static
// top-level import would freeze BOT_API_URL etc. to vitest.config's
// placeholder defaults before any per-test vi.stubEnv ever runs. Matches the
// pattern in bot-api.spec.ts.
let createSubscriptionImpl: typeof import("./subscriptions").createSubscriptionImpl;
let deleteSubscriptionImpl: typeof import("./subscriptions").deleteSubscriptionImpl;
let listSubscriptionsImpl: typeof import("./subscriptions").listSubscriptionsImpl;
let updateSubscriptionImpl: typeof import("./subscriptions").updateSubscriptionImpl;

beforeAll(async () => {
  for (const [key, value] of Object.entries(TEST_ENV)) vi.stubEnv(key, value);
  ({
    createSubscriptionImpl,
    deleteSubscriptionImpl,
    listSubscriptionsImpl,
    updateSubscriptionImpl,
  } = await import("./subscriptions"));
});

beforeEach(() => {
  for (const [key, value] of Object.entries(TEST_ENV)) vi.stubEnv(key, value);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("subscriptions impls", () => {
  it("lists with query filters", async () => {
    const spy = stubFetch(200, { subscriptions: [SUB] });
    const result = await listSubscriptionsImpl({ channelId: SUB.channelId });
    expect(result.subscriptions).toHaveLength(1);
    expect(String(spy.mock.calls[0]?.[0])).toBe(
      "http://bot.internal:3000/api/v1/subscriptions?channelId=123456789012345678",
    );
  });

  it("creates via channel-scoped POST with regionCode body", async () => {
    const spy = stubFetch(200, { created: true });
    await createSubscriptionImpl({
      channelId: SUB.channelId,
      regionCode: "US-CA-085",
    });
    const [url, init] = spy.mock.calls[0] ?? [];
    expect(String(url)).toBe(
      "http://bot.internal:3000/api/v1/channels/123456789012345678/subscriptions",
    );
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({ regionCode: "US-CA-085" });
  });

  it("toggles active via PATCH with the region key in the body", async () => {
    const spy = stubFetch(200, { subscription: { ...SUB, active: false } });
    const result = await updateSubscriptionImpl({
      active: false,
      channelId: SUB.channelId,
      countyCode: SUB.countyCode,
      stateCode: SUB.stateCode,
    });
    expect(result.subscription.active).toBe(false);
    const [, init] = spy.mock.calls[0] ?? [];
    expect(init?.method).toBe("PATCH");
    expect(JSON.parse(String(init?.body))).toEqual({
      active: false,
      countyCode: "US-CA-085",
      stateCode: "US-CA",
    });
  });

  it("deletes with the region key in the query string", async () => {
    const spy = stubFetch(200, { deleted: true });
    await deleteSubscriptionImpl({
      channelId: SUB.channelId,
      countyCode: SUB.countyCode,
      stateCode: SUB.stateCode,
    });
    const [url, init] = spy.mock.calls[0] ?? [];
    expect(init?.method).toBe("DELETE");
    expect(String(url)).toBe(
      "http://bot.internal:3000/api/v1/channels/123456789012345678/subscriptions?countyCode=US-CA-085&stateCode=US-CA",
    );
  });

  it("propagates bot error envelopes", async () => {
    stubFetch(404, {
      error: { code: "NOT_FOUND", message: "no such subscription" },
    });
    await expect(
      deleteSubscriptionImpl({
        channelId: SUB.channelId,
        countyCode: SUB.countyCode,
        stateCode: SUB.stateCode,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
  });
});
