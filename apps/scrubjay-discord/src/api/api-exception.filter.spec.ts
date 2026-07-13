import type { ArgumentsHost } from "@nestjs/common";
import { BadRequestException, Logger, NotFoundException } from "@nestjs/common";
import { BaseExceptionFilter } from "@nestjs/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiExceptionFilter } from "./api-exception.filter";

function hostWithResponse(url = "/api/v1/guilds") {
  const json = vi.fn();
  const status = vi.fn().mockReturnValue({ json });
  const host = {
    switchToHttp: () => ({
      getRequest: () => ({ originalUrl: url }),
      getResponse: () => ({ status }),
    }),
  } as unknown as ArgumentsHost;
  return { host, json, status };
}

describe("ApiExceptionFilter", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("wraps HttpExceptions in the error envelope", () => {
    const { host, json, status } = hostWithResponse();
    new ApiExceptionFilter().catch(new NotFoundException("no such row"), host);
    expect(status).toHaveBeenCalledWith(404);
    expect(json).toHaveBeenCalledWith({
      error: { code: "NOT_FOUND", details: undefined, message: "no such row" },
    });
  });

  it("preserves custom codes and details from exception bodies", () => {
    const { host, json } = hostWithResponse();
    new ApiExceptionFilter().catch(
      new BadRequestException({
        code: "VALIDATION",
        details: { limit: ["bad"] },
        message: "Invalid request",
      }),
      host,
    );
    expect(json).toHaveBeenCalledWith({
      error: {
        code: "VALIDATION",
        details: { limit: ["bad"] },
        message: "Invalid request",
      },
    });
  });

  it("maps malformed-body (body-parser) errors to a 400 BAD_REQUEST envelope", () => {
    const { host, json, status } = hostWithResponse();
    // Shape of an Express body-parser JSON parse failure: an http-errors
    // object (not a Nest HttpException) with a numeric `status`.
    const parseError = Object.assign(new SyntaxError("Unexpected token x"), {
      status: 400,
      statusCode: 400,
      type: "entity.parse.failed",
    });
    new ApiExceptionFilter().catch(parseError, host);
    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith({
      error: {
        code: "BAD_REQUEST",
        details: undefined,
        message: "Unexpected token x",
      },
    });
  });

  it("maps unknown errors to a 500 INTERNAL envelope and logs them", () => {
    const { host, json, status } = hostWithResponse();
    const error = vi
      .spyOn(Logger.prototype, "error")
      .mockImplementation(() => {});
    const boom = new Error("boom");
    new ApiExceptionFilter().catch(boom, host);
    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith({
      error: {
        code: "INTERNAL",
        details: undefined,
        message: "Internal server error",
      },
    });
    expect(error).toHaveBeenCalledWith(boom);
  });

  it("delegates non-/api requests to Nest's default handling", () => {
    const { host, json } = hostWithResponse("/health");
    const superCatch = vi
      .spyOn(BaseExceptionFilter.prototype, "catch")
      .mockImplementation(() => {});
    const exception = new NotFoundException("plain");
    new ApiExceptionFilter().catch(exception, host);
    // Falls through to the base filter — no envelope written here.
    expect(superCatch).toHaveBeenCalledWith(exception, host);
    expect(json).not.toHaveBeenCalled();
  });
});
