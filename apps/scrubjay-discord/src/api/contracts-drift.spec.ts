import {
  deliverySchema,
  observationSchema,
  pendingAlertSchema,
} from "@scrubjay/api-contracts";
import { describe, expect, it } from "vitest";
import type { PendingEBirdAlert } from "@/features/dispatch/alert-queue.repository";
import type { OpsRepository } from "./ops.repository";

/**
 * Drift guard for the three read endpoints that serialize an internal row type
 * straight to the wire. Each fixture is declared AS the bot's own row type, so a
 * rename on the bot side stops this file compiling; each fixture is then
 * round-tripped through the matching contract schema (`JSON.stringify` turns
 * `Date`s into the ISO strings the wire actually carries), so a rename on the
 * contract side fails the parse. The sorted-key comparison closes the loop in
 * the reverse direction: a contract field the bot never supplies (or a bot field
 * the contract dropped) desyncs the two key sets even when every shared field
 * still validates.
 *
 * Row shapes are derived from the repositories themselves — never hand-copied —
 * so the fixtures track the live SELECT projection.
 */

type ObservationRow = Awaited<
  ReturnType<OpsRepository["listObservations"]>
>["observations"][number];

type DeliveryRow = Awaited<
  ReturnType<OpsRepository["listDeliveries"]>
>["deliveries"][number];

/** Wire serialization the controllers actually perform: JSON, Dates → ISO. */
function toWire<T>(row: T): unknown {
  return JSON.parse(JSON.stringify(row));
}

describe("contract drift: pending alert", () => {
  const pending: PendingEBirdAlert = {
    audioCount: 0,
    channelId: "CH1",
    comName: "Vermilion Flycatcher",
    county: "Santa Clara",
    createdAt: new Date("2026-07-13T00:00:00.000Z"),
    howMany: 2,
    isPrivate: false,
    locationName: "Ed Levin County Park",
    locId: "L001",
    obsDt: new Date("2026-07-12T14:30:00.000Z"),
    photoCount: 3,
    recentlyConfirmed: true,
    sciName: "Pyrocephalus rubinus",
    speciesCode: "verfly",
    state: "California",
    subId: "S001",
    videoCount: 1,
  };

  it("serializes through pendingAlertSchema", () => {
    const result = pendingAlertSchema.safeParse(toWire(pending));
    expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
  });

  it("has the same field set as the schema", () => {
    expect(Object.keys(pendingAlertSchema.shape).sort()).toEqual(
      Object.keys(pending).sort(),
    );
  });
});

describe("contract drift: observation", () => {
  const observation: ObservationRow = {
    audioCount: 0,
    comName: "Vermilion Flycatcher",
    county: "Santa Clara",
    countyCode: "US-CA-085",
    createdAt: new Date("2026-07-13T00:00:00.000Z"),
    howMany: 2,
    locationName: "Ed Levin County Park",
    locId: "L001",
    obsDt: new Date("2026-07-12T14:30:00.000Z"),
    obsReviewed: true,
    obsValid: true,
    photoCount: 3,
    sciName: "Pyrocephalus rubinus",
    speciesCode: "verfly",
    state: "California",
    stateCode: "US-CA",
    subId: "S001",
    videoCount: 1,
  };

  it("serializes through observationSchema", () => {
    const result = observationSchema.safeParse(toWire(observation));
    expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
  });

  it("has the same field set as the schema", () => {
    expect(Object.keys(observationSchema.shape).sort()).toEqual(
      Object.keys(observation).sort(),
    );
  });
});

describe("contract drift: delivery", () => {
  const sent: DeliveryRow = {
    alertId: "verfly:S001",
    channelId: "CH1",
    detail: null,
    id: 1,
    kind: "ebird",
    sentAt: new Date("2026-07-13T00:00:05.000Z"),
    status: "sent",
  };

  // Nullable fields exercised in their null shape: `detail` is null except on
  // failures, and `sentAt` is null until the row is actually sent.
  const pendingSend: DeliveryRow = {
    alertId: "verfly:S002",
    channelId: "CH2",
    detail: "50035: unknown channel",
    id: 2,
    kind: "ebird",
    sentAt: null,
    status: "failed",
  };

  it("serializes a sent delivery through deliverySchema", () => {
    const result = deliverySchema.safeParse(toWire(sent));
    expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
  });

  it("serializes a failed delivery with a null sentAt", () => {
    const result = deliverySchema.safeParse(toWire(pendingSend));
    expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
  });

  it("has the same field set as the schema", () => {
    expect(Object.keys(deliverySchema.shape).sort()).toEqual(
      Object.keys(sent).sort(),
    );
  });
});
