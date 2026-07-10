import { HealthIndicatorService } from "@nestjs/terminus";
import { describe, expect, it, vi } from "vitest";
import type { DrizzleService } from "@/core/drizzle/drizzle.service";
import { DatabaseHealthIndicator } from "./database.health";

describe("DatabaseHealthIndicator", () => {
  const makeIndicator = (execute: ReturnType<typeof vi.fn>) =>
    new DatabaseHealthIndicator(
      new HealthIndicatorService(),
      { db: { execute } } as unknown as DrizzleService,
    );

  it("reports up when SELECT 1 succeeds", async () => {
    const execute = vi.fn().mockResolvedValue([]);
    const result = await makeIndicator(execute).isHealthy("database");

    expect(result).toEqual({ database: { status: "up" } });
    expect(execute).toHaveBeenCalledOnce();
  });

  it("reports down with the error message when the query throws", async () => {
    const execute = vi.fn().mockRejectedValue(new Error("connection refused"));
    const result = await makeIndicator(execute).isHealthy("database");

    expect(result).toEqual({
      database: { message: "connection refused", status: "down" },
    });
  });
});
