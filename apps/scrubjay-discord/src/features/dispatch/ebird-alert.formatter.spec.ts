import type { EmbedBuilder } from "discord.js";
import { describe, expect, it } from "vitest";
import type { PendingEBirdAlert } from "./alert-queue.service";
import { planEBirdAlerts } from "./ebird-alert.formatter";

function makeAlert(
  overrides: Partial<PendingEBirdAlert> = {},
): PendingEBirdAlert {
  return {
    audioCount: 0,
    channelId: "CH1",
    comName: "Vermilion Flycatcher",
    county: "Santa Clara",
    createdAt: new Date("2026-07-07T12:00:00Z"),
    howMany: 1,
    isPrivate: false,
    locationName: "Test Hotspot",
    locId: "L001",
    obsDt: new Date("2026-07-07T09:00:00Z"),
    photoCount: 0,
    recentlyConfirmed: false,
    sciName: "Pyrocephalus rubinus",
    speciesCode: "verfly",
    state: "California",
    subId: "S001",
    videoCount: 0,
    ...overrides,
  };
}

function embedOf(plan: { message: { embeds?: readonly unknown[] } }) {
  return (plan.message.embeds?.[0] as EmbedBuilder).data;
}

describe("planEBirdAlerts", () => {
  it("returns no plans for no pending alerts", () => {
    expect(planEBirdAlerts([])).toEqual([]);
  });

  it("makes one plan per channel × species × location group", () => {
    const plans = planEBirdAlerts([
      makeAlert({ subId: "S001" }),
      makeAlert({ subId: "S002" }), // same group as S001
      makeAlert({ channelId: "CH2", subId: "S001" }), // other channel
      makeAlert({ locId: "L002", subId: "S003" }), // other location
    ]);

    expect(plans).toHaveLength(3);
    const first = plans.find(
      (p) => p.channelId === "CH1" && p.alerts[0].locId === "L001",
    );
    expect(first?.alerts.map((a) => a.subId)).toEqual(["S001", "S002"]);
  });

  it("builds the embed with title, checklist URL, and unconfirmed color", () => {
    const [plan] = planEBirdAlerts([makeAlert()]);
    const embed = embedOf(plan);

    expect(embed.title).toBe("Vermilion Flycatcher - Santa Clara");
    expect(embed.url).toBe("https://ebird.org/checklist/S001");
    expect(embed.color).toBe(0xf1c40f);
    expect(embed.fields?.[0].value).toContain(
      "unconfirmed at location in the last week",
    );
  });

  it("uses green and confirmed copy when recently confirmed", () => {
    const [plan] = planEBirdAlerts([makeAlert({ recentlyConfirmed: true })]);
    const embed = embedOf(plan);

    expect(embed.color).toBe(0x2ecc71);
    expect(embed.fields?.[0].value).toContain(
      "confirmed at location in the last week",
    );
  });

  it("hides the hotspot link for private locations", () => {
    const [plan] = planEBirdAlerts([makeAlert({ isPrivate: true })]);

    expect(embedOf(plan).description).toContain(
      "Reported at a private location",
    );
    expect(embedOf(plan).description).not.toContain("ebird.org/hotspot");
  });

  it("aggregates report and media counts and shows the latest report time", () => {
    const later = new Date("2026-07-07T11:30:00Z");
    const [plan] = planEBirdAlerts([
      makeAlert({ photoCount: 2, subId: "S001" }),
      makeAlert({ audioCount: 1, obsDt: later, subId: "S002" }),
    ]);
    const embed = embedOf(plan);

    expect(embed.fields?.[0].value).toContain("👥 2 new report(s)");
    expect(embed.fields?.[0].value).toContain("📷 2 photo(s)");
    expect(embed.fields?.[0].value).toContain("🔊 1 audio");
    expect(embed.fields?.[0].value).not.toContain("🎥");
    expect(embed.description).toContain(
      later.toLocaleString("en-US", {
        day: "numeric",
        hour: "numeric",
        hour12: true,
        minute: "2-digit",
        month: "numeric",
        year: "numeric",
      }),
    );
  });
});
