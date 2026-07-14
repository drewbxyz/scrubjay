import {
  Body,
  Controller,
  Get,
  type INestApplication,
  Logger,
  NotFoundException,
  Post,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { APP_FILTER, APP_GUARD } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { API_PREFIX } from "./api.constants";
import { ApiExceptionFilter } from "./api-exception.filter";
import { ApiTokenGuard } from "./api-token.guard";

const TOKEN = "a".repeat(32);

// A stand-in for the real API controllers: routes under /api/v1/* (enveloped
// by the global filter and guarded by the global APP_GUARD) plus one route
// outside /api/ (default Nest handling, no token required). Crucially the
// controller carries NO @UseGuards decorator — its /api/ routes must still be
// guarded by the module-level APP_GUARD.
@Controller()
class ProbeController {
  @Get(`${API_PREFIX}/probe`)
  probe(): { ok: true } {
    return { ok: true };
  }

  @Post(`${API_PREFIX}/echo`)
  echo(@Body() body: unknown): { body: unknown } {
    return { body };
  }

  @Get("health")
  health(): { status: "ok" } {
    return { status: "ok" };
  }

  @Get("other/boom")
  otherBoom(): never {
    throw new NotFoundException("plain");
  }
}

describe("ApiExceptionFilter (e2e)", () => {
  let app: INestApplication;

  beforeEach(async () => {
    // The filter logs unknown errors; keep test output quiet.
    vi.spyOn(Logger.prototype, "error").mockImplementation(() => {});
    const moduleRef = await Test.createTestingModule({
      controllers: [ProbeController],
      providers: [
        // Mirror ApiModule's global wiring: fail-closed guard + envelope
        // filter, both registered module-globally rather than per-controller.
        { provide: APP_FILTER, useClass: ApiExceptionFilter },
        { provide: APP_GUARD, useClass: ApiTokenGuard },
        { provide: ConfigService, useValue: { get: () => TOKEN } },
      ],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    await app.init();
    await app.listen(0);
  });

  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
  });

  it("guards an undecorated /api/ route via the global guard (401 envelope)", async () => {
    const url = await app.getUrl();
    const res = await fetch(`${url}/api/v1/probe`);
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.error.code).toBe("UNAUTHORIZED");
    expect(typeof body.error.message).toBe("string");
    expect(body.statusCode).toBeUndefined();
  });

  it("allows an undecorated /api/ route with the correct bearer token", async () => {
    const url = await app.getUrl();
    const res = await fetch(`${url}/api/v1/probe`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true });
  });

  it("leaves the allowlisted /health route reachable without a token", async () => {
    const url = await app.getUrl();
    const res = await fetch(`${url}/health`);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ status: "ok" });
  });

  it("guards a case-variant /API/ route with the envelope (401)", async () => {
    // Express routes case-insensitively, so /API/v1/probe reaches the handler;
    // the default-closed guard must still demand a token and the filter must
    // still envelope the 401.
    const url = await app.getUrl();
    const res = await fetch(`${url}/API/v1/probe`);
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.error.code).toBe("UNAUTHORIZED");
    expect(typeof body.error.message).toBe("string");
    expect(body.statusCode).toBeUndefined();
  });

  it("envelopes malformed JSON bodies as a 400 (body-parser bypass)", async () => {
    const url = await app.getUrl();
    const res = await fetch(`${url}/api/v1/echo`, {
      body: "{ not valid json ",
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error.code).toBe("BAD_REQUEST");
    expect(typeof body.error.message).toBe("string");
    expect(body.statusCode).toBeUndefined();
  });

  it("envelopes 404s for unknown /api/v1 paths", async () => {
    const url = await app.getUrl();
    const res = await fetch(`${url}/api/v1/does-not-exist`);
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error.code).toBe("NOT_FOUND");
    expect(body.statusCode).toBeUndefined();
  });

  it("leaves non-/api errors in Nest's default shape", async () => {
    // /other/boom is not allowlisted, so the default-closed guard requires a
    // token to reach the handler; the filter then delegates non-/api errors to
    // Nest's default shape rather than the envelope.
    const url = await app.getUrl();
    const res = await fetch(`${url}/other/boom`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    const body = await res.json();

    expect(res.status).toBe(404);
    // Default Nest envelope, not the API one.
    expect(body.statusCode).toBe(404);
    expect(body.error).toBe("Not Found");
    expect(body.message).toBe("plain");
  });
});
