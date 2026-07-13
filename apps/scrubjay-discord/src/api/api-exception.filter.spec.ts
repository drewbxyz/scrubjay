import type { ArgumentsHost } from "@nestjs/common";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { ApiExceptionFilter } from "./api-exception.filter";

function hostWithResponse() {
  const json = vi.fn();
  const status = vi.fn().mockReturnValue({ json });
  const host = {
    switchToHttp: () => ({ getResponse: () => ({ status }) }),
  } as unknown as ArgumentsHost;
  return { host, json, status };
}

describe("ApiExceptionFilter", () => {
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

  it("maps unknown errors to a 500 INTERNAL envelope", () => {
    const { host, json, status } = hostWithResponse();
    new ApiExceptionFilter().catch(new Error("boom"), host);
    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith({
      error: {
        code: "INTERNAL",
        details: undefined,
        message: "Internal server error",
      },
    });
  });
});
