import { NotFoundException } from "@nestjs/common";
import { listFiltersResponseSchema } from "@scrubjay/api-contracts";
import { describe, expect, it, vi } from "vitest";
import type { FiltersRepository } from "@/features/filters/filters.repository";
import { FiltersController } from "./filters.controller";

describe("FiltersController", () => {
  it("lists filters in the contract shape", async () => {
    const repo = {
      channelFilters: vi
        .fn()
        .mockResolvedValue([{ channelId: "CH1", commonName: "Verdin" }]),
    } as unknown as FiltersRepository;
    const result = await new FiltersController(repo).list("CH1");
    expect(listFiltersResponseSchema.parse(result).filters).toHaveLength(1);
    expect(repo.channelFilters).toHaveBeenCalledWith("CH1");
  });

  it("reports added=true when a row was inserted", async () => {
    const repo = {
      addChannelFilter: vi
        .fn()
        .mockResolvedValue([{ channelId: "CH1", commonName: "Verdin" }]),
    } as unknown as FiltersRepository;
    const result = await new FiltersController(repo).add("CH1", {
      commonName: "Verdin",
    });
    expect(result).toEqual({ added: true });
    expect(repo.addChannelFilter).toHaveBeenCalledWith("CH1", "Verdin");
  });

  it("reports added=false when the filter already existed", async () => {
    const repo = {
      addChannelFilter: vi.fn().mockResolvedValue([]),
    } as unknown as FiltersRepository;
    const result = await new FiltersController(repo).add("CH1", {
      commonName: "Verdin",
    });
    expect(result).toEqual({ added: false });
  });

  it("removes a filter using the exact stored name, edge whitespace intact", async () => {
    const repo = {
      removeChannelFilter: vi.fn().mockResolvedValue(true),
    } as unknown as FiltersRepository;
    await new FiltersController(repo).remove("CH1", { commonName: " Verdin " });
    expect(repo.removeChannelFilter).toHaveBeenCalledWith("CH1", " Verdin ");
  });

  it("404s removing a filter that does not exist", async () => {
    const repo = {
      removeChannelFilter: vi.fn().mockResolvedValue(false),
    } as unknown as FiltersRepository;
    await expect(
      new FiltersController(repo).remove("CH1", { commonName: "Verdin" }),
    ).rejects.toThrow(NotFoundException);
  });
});
