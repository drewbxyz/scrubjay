import { type INestApplication, Logger } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FiltersRepository } from "@/features/filters/filters.repository";
import { SubscriptionsRepository } from "@/features/subscriptions/subscriptions.repository";
import { SubscriptionsService } from "@/features/subscriptions/subscriptions.service";
import { ApiTokenGuard } from "./api-token.guard";
import { FiltersController } from "./filters.controller";
import { GuildsService } from "./guilds.service";
import { SubscriptionsController } from "./subscriptions.controller";

/**
 * The idempotent "ensure" endpoints answer 200 with an honest flag rather than
 * Nest's default POST 201. Controller unit specs call handlers directly and so
 * never see `@HttpCode`; only a real HTTP round-trip proves the status code.
 */
describe("honest POST status codes (e2e)", () => {
  let app: INestApplication;
  const subscribe = vi.fn();
  const addChannelFilter = vi.fn();

  beforeEach(async () => {
    vi.spyOn(Logger.prototype, "error").mockImplementation(() => {});
    const moduleRef = await Test.createTestingModule({
      controllers: [SubscriptionsController, FiltersController],
      providers: [
        { provide: SubscriptionsRepository, useValue: {} },
        { provide: SubscriptionsService, useValue: { subscribe } },
        {
          provide: GuildsService,
          useValue: { isPostableChannel: async () => true },
        },
        { provide: FiltersRepository, useValue: { addChannelFilter } },
      ],
    })
      .overrideGuard(ApiTokenGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = moduleRef.createNestApplication({ logger: false });
    await app.init();
    await app.listen(0);
  });

  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
  });

  async function post(path: string, body: unknown) {
    const url = await app.getUrl();
    const res = await fetch(`${url}${path}`, {
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    return { body: await res.json(), status: res.status };
  }

  it("a fresh subscribe answers 200 { created: true }", async () => {
    subscribe.mockResolvedValue(true);
    const res = await post(
      "/api/v1/channels/123456789012345678/subscriptions",
      {
        regionCode: "US-CA",
      },
    );
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ created: true });
  });

  it("a duplicate subscribe answers 200 { created: false }", async () => {
    subscribe.mockResolvedValue(false);
    const res = await post(
      "/api/v1/channels/123456789012345678/subscriptions",
      {
        regionCode: "US-CA",
      },
    );
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ created: false });
  });

  it("a duplicate filter-add answers 200 { added: false }", async () => {
    addChannelFilter.mockResolvedValue([]);
    const res = await post("/api/v1/channels/123456789012345678/filters", {
      commonName: "Verdin",
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ added: false });
  });
});
