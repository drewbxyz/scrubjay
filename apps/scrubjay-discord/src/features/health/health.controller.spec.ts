import type { INestApplication } from "@nestjs/common";
import { Logger } from "@nestjs/common";
import { TerminusModule } from "@nestjs/terminus";
import { Test } from "@nestjs/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DrizzleService } from "@/core/drizzle/drizzle.service";
import { HealthController } from "./health.controller";
import { HealthRepository } from "./health.repository";
import { HealthStateService } from "./health-state.service";
import { DatabaseHealthIndicator } from "./indicators/database.health";
import { DispatchHealthIndicator } from "./indicators/dispatch.health";
import { IngestHealthIndicator } from "./indicators/ingest.health";

describe("HealthController", () => {
  let app: INestApplication;
  const executeMock = vi.fn();

  const startApp = async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      imports: [TerminusModule],
      providers: [
        DatabaseHealthIndicator,
        DispatchHealthIndicator,
        HealthStateService,
        IngestHealthIndicator,
        { provide: DrizzleService, useValue: { db: { execute: executeMock } } },
        {
          provide: HealthRepository,
          useValue: {
            recentDeliveryCounts: vi.fn().mockResolvedValue({
              expired: 0,
              failed: 0,
              sent: 0,
              suppressed: 0,
            }),
          },
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication({ logger: false });
    await app.init();
    await app.listen(0);
    return app.getUrl();
  };

  beforeEach(() => {
    executeMock.mockReset();
    // Terminus logs failed checks; keep test output quiet.
    vi.spyOn(Logger.prototype, "error").mockImplementation(() => {});
  });

  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
  });

  it("returns 200 with all indicators when the DB is reachable", async () => {
    executeMock.mockResolvedValue([]);
    const url = await startApp();

    const res = await fetch(`${url}/health`);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.status).toBe("ok");
    expect(body.info.database.status).toBe("up");
    expect(body.info.ingest.status).toBe("up");
    expect(body.info.dispatch.last24h).toEqual({
      expired: 0,
      failed: 0,
      sent: 0,
      suppressed: 0,
    });
  });

  it("returns 503 when the DB ping fails", async () => {
    executeMock.mockRejectedValue(new Error("connection refused"));
    const url = await startApp();

    const res = await fetch(`${url}/health`);
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body.status).toBe("error");
    expect(body.error.database.status).toBe("down");
  });
});
