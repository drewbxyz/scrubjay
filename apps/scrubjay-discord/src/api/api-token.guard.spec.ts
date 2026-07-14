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

function contextWithUrls(originalUrl: string, url: string): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ headers: {}, originalUrl, url }),
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

  it("allows an allowlisted public path without a token", () => {
    expect(
      guardWithToken(TOKEN).canActivate(contextWithAuth(undefined, "/health")),
    ).toBe(true);
  });

  it("allows an allowlisted path case-insensitively (Express routes it)", () => {
    expect(
      guardWithToken(TOKEN).canActivate(contextWithAuth(undefined, "/HEALTH")),
    ).toBe(true);
  });

  it("allows an allowlisted path with a query string (query stripped)", () => {
    expect(
      guardWithToken(TOKEN).canActivate(
        contextWithAuth(undefined, "/health?verbose=1"),
      ),
    ).toBe(true);
  });

  it("rejects a case-variant API path without a token", () => {
    expect(() =>
      guardWithToken(TOKEN).canActivate(
        contextWithAuth(undefined, "/API/v1/guilds"),
      ),
    ).toThrow(UnauthorizedException);
  });

  it("rejects an unknown non-API path without a token (default-closed)", () => {
    expect(() =>
      guardWithToken(TOKEN).canActivate(contextWithAuth(undefined, "/foo")),
    ).toThrow(UnauthorizedException);
  });

  it("prefers originalUrl over url when deciding the path", () => {
    // originalUrl is allowlisted, url is not: the allow decision must follow
    // originalUrl.
    expect(
      guardWithToken(TOKEN).canActivate(
        contextWithUrls("/health", "/api/v1/thing"),
      ),
    ).toBe(true);

    // The inverse: originalUrl is guarded, url is public — must be rejected.
    expect(() =>
      guardWithToken(TOKEN).canActivate(
        contextWithUrls("/api/v1/thing", "/health"),
      ),
    ).toThrow(UnauthorizedException);
  });
});
