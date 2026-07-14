import { BadRequestException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ZodValidationPipe } from "./zod-validation.pipe";

const schema = z.object({ limit: z.coerce.number().int().default(50) });

describe("ZodValidationPipe", () => {
  it("returns the parsed value with defaults applied", () => {
    expect(new ZodValidationPipe(schema).transform({})).toEqual({ limit: 50 });
  });

  it("coerces string query params", () => {
    expect(new ZodValidationPipe(schema).transform({ limit: "5" })).toEqual({
      limit: 5,
    });
  });

  it("throws BadRequestException with a VALIDATION code on failure", () => {
    try {
      new ZodValidationPipe(schema).transform({ limit: "not-a-number" });
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(BadRequestException);
      const body = (err as BadRequestException).getResponse() as {
        code: string;
      };
      expect(body.code).toBe("VALIDATION");
    }
  });
});
