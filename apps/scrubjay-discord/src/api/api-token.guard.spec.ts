import type { ExecutionContext } from "@nestjs/common";
import { UnauthorizedException } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import { describe, expect, it } from "vitest";
import type { AppConfig } from "@/core/config/config.schema";
import { ApiTokenGuard } from "./api-token.guard";

const TOKEN = "a".repeat(32);

function contextWithAuth(
  header?: string,
  url = "/api/v1/thing",
): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ headers: { authorization: header }, url }),
    }),
  } as unknown as ExecutionContext;
}

function guardWithToken(token?: string): ApiTokenGuard {
  const config = {
    get: () => token,
  } as unknown as ConfigService<AppConfig, true>;
  return new ApiTokenGuard(config);
}

describe("ApiTokenGuard", () => {
  it("allows a matching bearer token", () => {
    expect(
      guardWithToken(TOKEN).canActivate(contextWithAuth(`Bearer ${TOKEN}`)),
    ).toBe(true);
  });

  it("rejects a wrong token", () => {
    expect(() =>
      guardWithToken(TOKEN).canActivate(contextWithAuth("Bearer nope")),
    ).toThrow(UnauthorizedException);
  });

  it("rejects a missing Authorization header", () => {
    expect(() => guardWithToken(TOKEN).canActivate(contextWithAuth())).toThrow(
      UnauthorizedException,
    );
  });

  it("rejects everything when no token is configured", () => {
    expect(() =>
      guardWithToken(undefined).canActivate(contextWithAuth(`Bearer ${TOKEN}`)),
    ).toThrow(UnauthorizedException);
  });

  it("allows non-API paths without a token (fail-open outside /api/)", () => {
    expect(
      guardWithToken(TOKEN).canActivate(contextWithAuth(undefined, "/health")),
    ).toBe(true);
  });
});
