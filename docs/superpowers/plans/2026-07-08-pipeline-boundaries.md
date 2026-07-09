# Pipeline Boundaries Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align both pipelines with the domain language: dispatch's send-then-record protocol moves into a single `DispatchService` (kind-specific code becomes a pure formatter), ingest's two-table persistence folds into one transactional repository method behind a domain `Observation` type, and file names follow NestJS `<name>.<role>.ts` conventions throughout.

**Architecture:** Two pipeline services (`IngestService`, `DispatchService`), each with one deep persistence seam (`ObservationRepository`, `AlertQueue`). Vendor-specific code (eBird fetcher/transformer) and kind-specific code (eBird alert formatter) are pure edges. The eBird→domain vocabulary translation happens in the transformer; repositories map domain fields to columns 1:1.

**Tech Stack:** NestJS 11, drizzle-orm (node-postgres), discord.js 14, Jest + Testcontainers (Postgres), pnpm workspace, Biome.

## Global Constraints

- All work happens in `apps/scrubjay-discord/`. Run commands from that directory unless a path is shown.
- Branch off current HEAD of `refactor/ebird-seam`: `git checkout -b refactor/pipeline-boundaries` (do this once, before Task 1).
- Object literal keys are **alphabetized** in this codebase (Biome style). Match it in all new/edited code.
- Path alias `@/` maps to `src/` (both tsconfig and jest `moduleNameMapper`).
- Tests hit a real Postgres via Testcontainers — **Docker must be running**. Run tests with `pnpm test <regex>` (jest positional arg filters by file path); full suite is `pnpm test`. Type check: `pnpm check-types`.
- Class `AlertQueue` keeps its name (CONTEXT.md domain term). Only its **file** gets the `.service.ts` suffix.
- Do NOT introduce a `Dispatcher` interface, DI multi-provider token, or per-kind registry. One kind exists; the seam is the `planEBirdAlerts` function signature.
- `kind: "ebird"`, `PendingEBirdAlert`, `pendingEBirdAlerts`, and `planEBirdAlerts` keep the eBird name — it is alert provenance (domain), not vendor branding.
- Intentional behavior changes (call them out in commits, don't "fix" them back):
  1. A failed Discord send is **no longer marked delivered** — the alert stays pending and retries next tick until it ages out of the 15-minute window.
  2. Location + observation upserts become **atomic** (one transaction).
  3. `dispatchSince(since)` — `since` becomes **required** (the only caller always passes it).
  4. The unused `howMany` aggregation in embed stats is dropped (it was computed, never rendered).

---

### Task 1: Rename `alert-queue.ts` → `alert-queue.service.ts`

Pure mechanical rename. Class names unchanged.

**Files:**
- Rename: `src/features/dispatch/alert-queue.ts` → `src/features/dispatch/alert-queue.service.ts`
- Rename: `src/features/dispatch/__tests__/alert-queue.spec.ts` → `src/features/dispatch/__tests__/alert-queue.service.spec.ts`
- Modify: `src/features/dispatch/dispatch.module.ts` (import path)
- Modify: `src/features/dispatch/ebird-dispatcher.service.ts` (import path; file is deleted in Task 3 but must compile until then)
- Modify: `src/features/jobs/bootstrap.service.ts` (import path)
- Modify: `src/features/jobs/__tests__/bootstrap.service.spec.ts` (import path)

**Interfaces:**
- Produces: module path `@/features/dispatch/alert-queue.service` (relative: `./alert-queue.service`) exporting `AlertQueue`, `SentAlert`, `PendingEBirdAlert` — Tasks 2 and 3 import from this path.

- [ ] **Step 1: Rename the files**

```bash
git mv src/features/dispatch/alert-queue.ts src/features/dispatch/alert-queue.service.ts
git mv src/features/dispatch/__tests__/alert-queue.spec.ts src/features/dispatch/__tests__/alert-queue.service.spec.ts
```

- [ ] **Step 2: Update every import of the old path**

Exact replacements (one per file):
- `src/features/dispatch/dispatch.module.ts`: `from "./alert-queue"` → `from "./alert-queue.service"`
- `src/features/dispatch/ebird-dispatcher.service.ts`: `from "./alert-queue"` → `from "./alert-queue.service"`
- `src/features/dispatch/__tests__/alert-queue.service.spec.ts`: `from "../alert-queue"` → `from "../alert-queue.service"`
- `src/features/jobs/bootstrap.service.ts`: `from "@/features/dispatch/alert-queue"` → `from "@/features/dispatch/alert-queue.service"`
- `src/features/jobs/__tests__/bootstrap.service.spec.ts`: `from "@/features/dispatch/alert-queue"` → `from "@/features/dispatch/alert-queue.service"`

Verify nothing is left: `grep -rn 'dispatch/alert-queue"' src && grep -rn 'from "\.\./alert-queue"' src && grep -rn 'from "\./alert-queue"' src` — all three should print nothing (grep exits 1).

- [ ] **Step 3: Verify types and tests pass**

Run: `pnpm check-types && pnpm test dispatch`
Expected: tsc clean; `alert-queue.service.spec.ts`, `alert-queue.repository.spec.ts` PASS.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor(dispatch): rename alert-queue.ts to alert-queue.service.ts per Nest file conventions"
```

---

### Task 2: Pure eBird alert formatter (`ebird-alert.formatter.ts`)

Extract grouping + stats + embed building from `EBirdDispatcherService` into a pure module. The dispatcher still exists and is untouched in this task — the formatter is added alongside with its own tests, TDD.

**Files:**
- Create: `src/features/dispatch/ebird-alert.formatter.ts`
- Create (co-located, not in `__tests__/`): `src/features/dispatch/ebird-alert.formatter.spec.ts`

**Interfaces:**
- Consumes: `PendingEBirdAlert` from `./alert-queue.service` (Task 1).
- Produces: `planEBirdAlerts(pending: PendingEBirdAlert[]): DispatchPlan[]` and `type DispatchPlan = { alerts: PendingEBirdAlert[]; channelId: string; message: MessageCreateOptions }`. Task 3's `DispatchService` iterates these plans.

- [ ] **Step 1: Write the failing spec**

Create `src/features/dispatch/ebird-alert.formatter.spec.ts`:

```ts
import type { EmbedBuilder } from "discord.js";
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

function embedOf(plan: { message: { embeds?: unknown[] } }) {
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
```

- [ ] **Step 2: Run spec to verify it fails**

Run: `pnpm test ebird-alert.formatter`
Expected: FAIL — `Cannot find module './ebird-alert.formatter'`

- [ ] **Step 3: Implement the formatter**

Create `src/features/dispatch/ebird-alert.formatter.ts`. The embed content is copied verbatim from `ebird-dispatcher.service.ts` (strings, emoji, colors, date options) — only the unused `howMany` stat is dropped:

```ts
import { EmbedBuilder, type MessageCreateOptions } from "discord.js";
import type { PendingEBirdAlert } from "./alert-queue.service";

export type DispatchPlan = {
  alerts: PendingEBirdAlert[];
  channelId: string;
  message: MessageCreateOptions;
};

/**
 * Pure planning step of the Dispatch pipeline: one embed per
 * channel × species × location group. Never touches the AlertQueue —
 * DispatchService owns the send-then-record protocol.
 */
export function planEBirdAlerts(pending: PendingEBirdAlert[]): DispatchPlan[] {
  const groups = new Map<string, PendingEBirdAlert[]>();
  for (const alert of pending) {
    const key = `${alert.channelId}:${alert.speciesCode}:${alert.locId}`;
    const group = groups.get(key);
    if (group) {
      group.push(alert);
    } else {
      groups.set(key, [alert]);
    }
  }

  return Array.from(groups.values(), (alerts) => ({
    alerts,
    channelId: alerts[0].channelId,
    message: { embeds: [buildEBirdAlertEmbed(alerts)] },
  }));
}

function aggregateStats(alerts: PendingEBirdAlert[]) {
  return alerts.reduce(
    (acc, alert) => {
      acc.totalReports += 1;
      acc.totalPhotos += alert.photoCount;
      acc.totalVideos += alert.videoCount;
      acc.totalAudio += alert.audioCount;
      acc.latestReport =
        alert.obsDt > acc.latestReport ? alert.obsDt : acc.latestReport;
      return acc;
    },
    {
      latestReport: alerts[0].obsDt,
      totalAudio: 0,
      totalPhotos: 0,
      totalReports: 0,
      totalVideos: 0,
    },
  );
}

function buildEBirdAlertEmbed(alerts: PendingEBirdAlert[]): EmbedBuilder {
  const stats = aggregateStats(alerts);
  const confirmed = alerts[0].recentlyConfirmed;

  const locationText = `Reported at ${
    alerts[0].isPrivate
      ? "a private location"
      : `[${alerts[0].locationName}](https://ebird.org/hotspot/${alerts[0].locId})`
  }`;

  const embed = new EmbedBuilder()
    .setTitle(`${alerts[0].comName} - ${alerts[0].county}`)
    .setURL(`https://ebird.org/checklist/${alerts[0].subId}`)
    .setDescription(
      `${locationText}\nLatest report: ${stats.latestReport.toLocaleString(
        "en-US",
        {
          day: "numeric",
          hour: "numeric",
          hour12: true,
          minute: "2-digit",
          month: "numeric",
          year: "numeric",
        },
      )}`,
    )
    .setColor(confirmed ? 0x2ecc71 : 0xf1c40f);

  let reportText = `👥 ${stats.totalReports} new report(s); ${
    confirmed
      ? "confirmed at location in the last week"
      : "unconfirmed at location in the last week"
  }`;

  const mediaTexts: string[] = [];
  if (stats.totalPhotos > 0)
    mediaTexts.push(`📷 ${stats.totalPhotos} photo(s)`);
  if (stats.totalAudio > 0) mediaTexts.push(`🔊 ${stats.totalAudio} audio`);
  if (stats.totalVideos > 0)
    mediaTexts.push(`🎥 ${stats.totalVideos} video(s)`);

  if (mediaTexts.length > 0) {
    reportText += `\n${mediaTexts.join(" • ")}`;
  }

  embed.addFields({ name: "Details", value: reportText });

  return embed;
}
```

- [ ] **Step 4: Run spec to verify it passes**

Run: `pnpm test ebird-alert.formatter`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add src/features/dispatch/ebird-alert.formatter.ts src/features/dispatch/ebird-alert.formatter.spec.ts
git commit -m "feat(dispatch): pure eBird alert formatter (plan = group + embed)"
```

---

### Task 3: `DispatchService` owns the protocol; delete `EBirdDispatcherService`

The one component that speaks the queue protocol: fetch pending → plan → send → record successes. Failed sends stay pending (behavior change #1). `since` becomes required (behavior change #3).

**Files:**
- Create: `src/features/dispatch/dispatch.service.ts`
- Create: `src/features/dispatch/dispatch.service.spec.ts`
- Delete: `src/features/dispatch/ebird-dispatcher.service.ts`
- Modify: `src/features/dispatch/dispatch.module.ts`
- Modify: `src/features/jobs/dispatch.job.ts`
- Modify: `src/features/jobs/__tests__/dispatch.job.spec.ts`

**Interfaces:**
- Consumes: `planEBirdAlerts`/`DispatchPlan` (Task 2); `AlertQueue`, `SentAlert` from `./alert-queue.service` (Task 1); `MessageSenderService.send(channelId: string, options: string | MessageCreateOptions): Promise<void>` from `@/discord/message-sender.service`.
- Produces: `DispatchService.dispatchSince(since: Date): Promise<void>` — `DispatchJob` calls this.

- [ ] **Step 1: Write the failing spec**

Create `src/features/dispatch/dispatch.service.spec.ts`:

```ts
import { Logger } from "@nestjs/common";
import type { MessageSenderService } from "@/discord/message-sender.service";
import type { AlertQueue, PendingEBirdAlert } from "./alert-queue.service";
import { DispatchService } from "./dispatch.service";

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

describe("DispatchService", () => {
  let service: DispatchService;

  const alertQueueMock = { markSent: jest.fn(), pendingEBirdAlerts: jest.fn() };
  const senderMock = { send: jest.fn() };

  const since = new Date("2026-07-08T00:00:00Z");

  beforeEach(() => {
    jest.spyOn(Logger.prototype, "debug").mockImplementation();
    jest.spyOn(Logger.prototype, "error").mockImplementation();
    jest.spyOn(Logger.prototype, "log").mockImplementation();

    alertQueueMock.pendingEBirdAlerts.mockReset().mockResolvedValue([]);
    alertQueueMock.markSent.mockReset().mockResolvedValue(undefined);
    senderMock.send.mockReset().mockResolvedValue(undefined);

    service = new DispatchService(
      alertQueueMock as unknown as AlertQueue,
      senderMock as unknown as MessageSenderService,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("asks the queue for alerts pending since the cutoff", async () => {
    await service.dispatchSince(since);

    expect(alertQueueMock.pendingEBirdAlerts).toHaveBeenCalledWith(since);
  });

  it("does not send or record when nothing is pending", async () => {
    await service.dispatchSince(since);

    expect(senderMock.send).not.toHaveBeenCalled();
    expect(alertQueueMock.markSent).not.toHaveBeenCalled();
  });

  it("sends one message per plan and records every sent alert", async () => {
    alertQueueMock.pendingEBirdAlerts.mockResolvedValue([
      makeAlert({ subId: "S001" }),
      makeAlert({ subId: "S002" }), // same group
      makeAlert({ channelId: "CH2", subId: "S001" }),
    ]);

    await service.dispatchSince(since);

    expect(senderMock.send).toHaveBeenCalledTimes(2);
    expect(alertQueueMock.markSent).toHaveBeenCalledWith([
      { channelId: "CH1", speciesCode: "verfly", subId: "S001" },
      { channelId: "CH1", speciesCode: "verfly", subId: "S002" },
      { channelId: "CH2", speciesCode: "verfly", subId: "S001" },
    ]);
  });

  it("leaves alerts pending when their send fails, still recording the rest", async () => {
    alertQueueMock.pendingEBirdAlerts.mockResolvedValue([
      makeAlert({ channelId: "CH1" }),
      makeAlert({ channelId: "CH2" }),
    ]);
    senderMock.send.mockRejectedValueOnce(new Error("channel gone")); // CH1

    await service.dispatchSince(since);

    expect(alertQueueMock.markSent).toHaveBeenCalledWith([
      { channelId: "CH2", speciesCode: "verfly", subId: "S001" },
    ]);
  });
});
```

- [ ] **Step 2: Run spec to verify it fails**

Run: `pnpm test dispatch.service`
Expected: FAIL — `Cannot find module './dispatch.service'`

- [ ] **Step 3: Implement `DispatchService`**

Create `src/features/dispatch/dispatch.service.ts`:

```ts
import { Injectable, Logger } from "@nestjs/common";
import { MessageSenderService } from "@/discord/message-sender.service";
import {
  AlertQueue,
  type PendingEBirdAlert,
  type SentAlert,
} from "./alert-queue.service";
import { planEBirdAlerts } from "./ebird-alert.formatter";

/**
 * The Dispatch pipeline: turns pending alerts into Discord embeds and
 * records deliveries. Owns the send-then-record protocol for every alert
 * kind — a failed send is NOT recorded, so the alert stays pending and
 * retries until it ages out of the dispatch window (at-least-once).
 */
@Injectable()
export class DispatchService {
  private readonly logger = new Logger(DispatchService.name);

  constructor(
    private readonly alertQueue: AlertQueue,
    private readonly sender: MessageSenderService,
  ) {}

  async dispatchSince(since: Date) {
    const pending = await this.alertQueue.pendingEBirdAlerts(since);

    if (pending.length === 0) {
      this.logger.debug(`No new alerts since ${since.toISOString()}`);
      return;
    }

    const sent: SentAlert[] = [];

    for (const plan of planEBirdAlerts(pending)) {
      try {
        await this.sender.send(plan.channelId, plan.message);
        sent.push(...plan.alerts.map(toSentAlert));
      } catch (err) {
        this.logger.error(
          `Send failed for channel ${plan.channelId}; alerts stay pending: ${err}`,
        );
      }
    }

    await this.alertQueue.markSent(sent);

    this.logger.log(`Marked ${sent.length} alerts as delivered`);
  }
}

function toSentAlert(alert: PendingEBirdAlert): SentAlert {
  return {
    channelId: alert.channelId,
    speciesCode: alert.speciesCode,
    subId: alert.subId,
  };
}
```

- [ ] **Step 4: Run spec to verify it passes**

Run: `pnpm test dispatch.service`
Expected: PASS (4 tests)

- [ ] **Step 5: Delete the old dispatcher and rewire module + job**

```bash
git rm src/features/dispatch/ebird-dispatcher.service.ts
```

Replace `src/features/dispatch/dispatch.module.ts` with:

```ts
import { Module } from "@nestjs/common";
import { DiscordModule } from "@/discord/discord.module";
import { AlertQueue } from "./alert-queue.service";
import { AlertQueueRepository } from "./alert-queue.repository";
import { DispatchService } from "./dispatch.service";

@Module({
  exports: [AlertQueue, DispatchService],
  imports: [DiscordModule],
  providers: [AlertQueue, AlertQueueRepository, DispatchService],
})
export class DispatchModule {}
```

Replace `src/features/jobs/dispatch.job.ts` with:

```ts
import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { DispatchService } from "@/features/dispatch/dispatch.service";
import { BootstrapService } from "./bootstrap.service";

@Injectable()
export class DispatchJob {
  private readonly logger = new Logger(DispatchJob.name);

  constructor(
    private readonly dispatch: DispatchService,
    private readonly bootstrapService: BootstrapService,
  ) {}

  @Cron("*/1 * * * *")
  async run() {
    try {
      // Wait for bootstrap to complete before running
      await this.bootstrapService.waitForBootstrap();

      const since = new Date(Date.now() - 15 * 60 * 1000);
      this.logger.debug(
        `Running dispatch job for alerts since ${since.toISOString()}`,
      );
      await this.dispatch.dispatchSince(since);
    } catch (err) {
      this.logger.error(`Dispatch tick failed: ${err}`);
    }
  }
}
```

In `src/features/jobs/__tests__/dispatch.job.spec.ts`, three replacements:
- `import type { EBirdDispatcherService } from "@/features/dispatch/ebird-dispatcher.service";` → `import type { DispatchService } from "@/features/dispatch/dispatch.service";`
- `dispatcherMock as unknown as EBirdDispatcherService,` → `dispatcherMock as unknown as DispatchService,`
- (variable name `dispatcherMock` may stay — it still mocks the thing DispatchJob injects.)

- [ ] **Step 6: Run types and affected tests**

Run: `pnpm check-types && pnpm test "dispatch|jobs"`
Expected: tsc clean; dispatch + jobs suites PASS.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor(dispatch): DispatchService owns send-then-record; failed sends stay pending

Replaces EBirdDispatcherService. Kind-specific work is now the pure
ebird-alert formatter; the queue protocol lives in exactly one place.
Behavior change: a failed send is no longer marked delivered — the alert
retries next tick until it ages out of the 15-minute window."
```

---

### Task 4: Mechanical ingest renames (`features/ebird` → `features/ingest`)

Zero behavior change — folder, file, and class renames only, reviewable as a pure rename. eBird names survive only on the vendor edge (fetcher, wire schema, transformer).

**Files:**
- Rename dir: `src/features/ebird/` → `src/features/ingest/`
- Rename: `ingest/ebird.module.ts` → `ingest/ingest.module.ts` (class `EBirdModule` → `IngestModule`)
- Rename: `ingest/ebird.service.ts` → `ingest/ingest.service.ts` (class `EBirdService` → `IngestService`)
- Rename: `ingest/ebird.repository.ts` → `ingest/observation.repository.ts` (class `EBirdRepository` → `ObservationRepository`)
- Rename: `ingest/__tests__/ebird.service.spec.ts` → `ingest/__tests__/ingest.service.spec.ts`
- Rename: `ingest/__tests__/ebird.repository.spec.ts` → `ingest/__tests__/observation.repository.spec.ts`
- Rename: `src/features/jobs/ebird-ingest.job.ts` → `src/features/jobs/ingest.job.ts` (class `EBirdIngestJob` → `IngestJob`)
- Rename: `src/features/jobs/__tests__/ebird-ingest.job.spec.ts` → `src/features/jobs/__tests__/ingest.job.spec.ts`
- Modify: `src/features/jobs/jobs.module.ts`, `src/features/jobs/bootstrap.service.ts`, `src/features/jobs/__tests__/bootstrap.service.spec.ts`
- Unchanged names (vendor edge): `ebird.fetcher.ts`, `ebird.schema.ts`, `ebird.transformer.ts` and their specs.

**Interfaces:**
- Produces: `IngestService.ingestRegion(regionCode: string): Promise<number>` at `@/features/ingest/ingest.service`; `ObservationRepository` at `@/features/ingest/observation.repository` (methods still `upsertLocation`/`upsertObservation` — Task 5 changes that). `IngestModule` at `@/features/ingest/ingest.module`.

- [ ] **Step 1: Move everything**

```bash
git mv src/features/ebird src/features/ingest
git mv src/features/ingest/ebird.module.ts src/features/ingest/ingest.module.ts
git mv src/features/ingest/ebird.service.ts src/features/ingest/ingest.service.ts
git mv src/features/ingest/ebird.repository.ts src/features/ingest/observation.repository.ts
git mv src/features/ingest/__tests__/ebird.service.spec.ts src/features/ingest/__tests__/ingest.service.spec.ts
git mv src/features/ingest/__tests__/ebird.repository.spec.ts src/features/ingest/__tests__/observation.repository.spec.ts
git mv src/features/jobs/ebird-ingest.job.ts src/features/jobs/ingest.job.ts
git mv src/features/jobs/__tests__/ebird-ingest.job.spec.ts src/features/jobs/__tests__/ingest.job.spec.ts
```

- [ ] **Step 2: Rename classes and fix imports**

Global identifier renames (whole-word, across `src/`): `EBirdService` → `IngestService`, `EBirdRepository` → `ObservationRepository`, `EBirdModule` → `IngestModule`, `EBirdIngestJob` → `IngestJob`. Do NOT touch `EBirdFetcher`, `EBirdTransformer`, `EBirdObservation`, `TransformedEBirdObservation`, `PendingEBirdAlert`, `channelEBirdSubscriptions`, `pendingEBirdAlerts`, `getEBirdSources`.

Import-path replacements:
- `ingest/ingest.module.ts`: `./ebird.service` → `./ingest.service`, `./ebird.repository` → `./observation.repository`
- `ingest/ingest.service.ts`: `./ebird.repository` → `./observation.repository`
- `ingest/__tests__/ingest.service.spec.ts`: `../ebird.service` → `../ingest.service`, `../ebird.repository` → `../observation.repository`
- `ingest/__tests__/observation.repository.spec.ts`: `../ebird.repository` → `../observation.repository`
- `jobs/ingest.job.ts`: `@/features/ebird/ebird.service` → `@/features/ingest/ingest.service`; constructor param `private readonly ebird: EBirdService` → `private readonly ingest: IngestService` (and `this.ebird.ingestRegion` → `this.ingest.ingestRegion`)
- `jobs/__tests__/ingest.job.spec.ts`: import path as above; `ebirdMock as unknown as EBirdService` → `ebirdMock as unknown as IngestService` (mock variable names may stay)
- `jobs/bootstrap.service.ts`: `@/features/ebird/ebird.service` → `@/features/ingest/ingest.service`; field `ebirdService: EBirdService` → `ingestService: IngestService`; `this.ebirdService.ingestRegion` → `this.ingestService.ingestRegion`
- `jobs/__tests__/bootstrap.service.spec.ts`: import path + `as unknown as IngestService`
- `jobs/jobs.module.ts`: full new content:

```ts
import { Module } from "@nestjs/common";
import { ScheduleModule } from "@nestjs/schedule";
import { DispatchModule } from "../dispatch/dispatch.module";
import { IngestModule } from "../ingest/ingest.module";
import { SourcesModule } from "../sources/sources.module";
import { BootstrapService } from "./bootstrap.service";
import { DispatchJob } from "./dispatch.job";
import { IngestJob } from "./ingest.job";

@Module({
  imports: [IngestModule, ScheduleModule, DispatchModule, SourcesModule],
  providers: [BootstrapService, IngestJob, DispatchJob],
})
export class JobsModule {}
```

Also rename the describe blocks: `describe("EBirdService", ...)` → `describe("IngestService", ...)`, `describe("EBirdRepository", ...)` → `describe("ObservationRepository", ...)`, `describe("EBirdIngestJob", ...)` → `describe("IngestJob", ...)`.

Verify: `grep -rn "features/ebird\|EBirdService\|EBirdRepository\|EBirdModule\|EBirdIngestJob" src` prints nothing.

- [ ] **Step 3: Full check**

Run: `pnpm check-types && pnpm test`
Expected: clean tsc; entire suite PASS (rename only, no behavior change).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor(ingest): rename features/ebird to features/ingest; vendor names stay on the edge

EBirdService->IngestService, EBirdRepository->ObservationRepository,
EBirdIngestJob->IngestJob. Fetcher/schema/transformer keep the eBird
name: they ARE the vendor adapter."
```

---

### Task 5: Fold location upsert into `upsertObservation` (transactional)

`ObservationRepository` gets one public method; `IngestService.ingestObservation` disappears. Types unchanged (still `TransformedEBirdObservation` — Task 6 swaps them).

**Files:**
- Modify: `src/features/ingest/observation.repository.ts`
- Modify: `src/features/ingest/ingest.service.ts`
- Modify: `src/features/ingest/__tests__/observation.repository.spec.ts`
- Modify: `src/features/ingest/__tests__/ingest.service.spec.ts`

**Interfaces:**
- Produces: `ObservationRepository.upsertObservation(data: TransformedEBirdObservation): Promise<void>` — the ONLY public method. `upsertLocation` no longer exists. `IngestService.ingestRegion` unchanged signature.

- [ ] **Step 1: Rewrite the repository spec (failing first)**

Replace the two describe blocks in `src/features/ingest/__tests__/observation.repository.spec.ts` with (imports/fixture `baseObservation` stay; remove the now-unused `seedLocation` import):

```ts
describe("ObservationRepository", () => {
  let db: DrizzleService;
  let pool: Pool;
  let repository: ObservationRepository;

  beforeAll(() => {
    ({ db, pool } = createTestDb());
    repository = new ObservationRepository(db);
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await truncateAll(db);
  });

  describe("upsertObservation", () => {
    it("persists the observation and its embedded location in one call", async () => {
      await repository.upsertObservation(baseObservation);

      const location = await db.db.query.locations.findFirst({
        where: eq(locations.id, "L001"),
      });
      const observation = await db.db.query.observations.findFirst({
        where: eq(observations.subId, "S001"),
      });
      expect(location?.name).toBe("Test Hotspot");
      expect(observation?.speciesCode).toBe("verfly");
    });

    it("updates mapped columns on conflict", async () => {
      await repository.upsertObservation(baseObservation);
      await repository.upsertObservation({ ...baseObservation, howMany: 7 });

      const row = await db.db.query.observations.findFirst({
        where: eq(observations.subId, "S001"),
      });
      expect(row?.howMany).toBe(7);
    });

    it("propagates location renames and privacy changes on conflict", async () => {
      await repository.upsertObservation(baseObservation);
      await repository.upsertObservation({
        ...baseObservation,
        locationPrivate: true,
        locName: "New Name",
      });

      const row = await db.db.query.locations.findFirst({
        where: eq(locations.id, "L001"),
      });
      expect(row?.name).toBe("New Name");
      expect(row?.isPrivate).toBe(true);
    });
  });
});
```

Run: `pnpm test observation.repository`
Expected: FAIL — first and third tests fail (`upsertObservation` violates the locations FK / `upsertLocation` signature mismatch).

- [ ] **Step 2: Implement the fold-in**

Replace the class body of `src/features/ingest/observation.repository.ts`:

```ts
@Injectable()
export class ObservationRepository {
  constructor(private readonly drizzle: DrizzleService) {}

  /**
   * Persist one ingested observation into the normalized schema. The
   * location embedded in the eBird payload is upserted in the same
   * transaction — locations have no independent lifecycle.
   */
  async upsertObservation(data: TransformedEBirdObservation): Promise<void> {
    await this.drizzle.db.transaction(async (tx) => {
      await tx
        .insert(locations)
        .values({
          county: data.subnational2Name,
          countyCode: data.subnational2Code,
          id: data.locId,
          isPrivate: data.locationPrivate,
          lat: data.lat,
          lng: data.lng,
          name: data.locName,
          state: data.subnational1Name,
          stateCode: data.subnational1Code,
        })
        .onConflictDoUpdate({
          set: {
            county: data.subnational2Name,
            countyCode: data.subnational2Code,
            isPrivate: data.locationPrivate,
            lastUpdated: new Date(),
            lat: data.lat,
            lng: data.lng,
            name: data.locName,
            state: data.subnational1Name,
            stateCode: data.subnational1Code,
          },
          target: [locations.id],
        });

      await tx
        .insert(observations)
        .values({
          audioCount: data.audioCount,
          comName: data.comName,
          hasComments: data.hasComments,
          howMany: data.howMany ?? 0,
          locId: data.locId,
          obsDt: new Date(data.obsDt),
          obsReviewed: data.obsReviewed,
          obsValid: data.obsValid,
          photoCount: data.photoCount,
          presenceNoted: data.presenceNoted,
          sciName: data.sciName,
          speciesCode: data.speciesCode,
          subId: data.subId,
          videoCount: data.videoCount,
        })
        .onConflictDoUpdate({
          set: {
            audioCount: data.audioCount,
            comName: data.comName,
            hasComments: data.hasComments,
            howMany: data.howMany ?? 0,
            lastUpdated: new Date(),
            locId: data.locId,
            obsDt: new Date(data.obsDt),
            obsReviewed: data.obsReviewed,
            obsValid: data.obsValid,
            photoCount: data.photoCount,
            presenceNoted: data.presenceNoted,
            sciName: data.sciName,
            videoCount: data.videoCount,
          },
          target: [observations.speciesCode, observations.subId],
        });
    });
  }
}
```

(Deletes `upsertLocation` and both `.returning()` calls.)

In `src/features/ingest/ingest.service.ts`: delete the `ingestObservation` method entirely and change the loop body from `await this.ingestObservation(obs);` to `await this.repo.upsertObservation(obs);`.

- [ ] **Step 3: Update the service spec**

In `src/features/ingest/__tests__/ingest.service.spec.ts`:
- `repoMock` becomes `{ upsertObservation: jest.fn() }` (drop `upsertLocation`).
- Delete the test `"writes a single observation to both location and observation tables"`.
- Replace the test `"ingests transformed observations for a region"` body — no more spy:

```ts
  it("ingests transformed observations for a region", async () => {
    fetcherMock.fetchRareObservations.mockResolvedValue([rawObservation]);
    transformerMock.transformObservations.mockReturnValue([
      transformedObservation,
    ]);

    const inserted = await service.ingestRegion("US-WA");

    expect(fetcherMock.fetchRareObservations).toHaveBeenCalledWith("US-WA");
    expect(transformerMock.transformObservations).toHaveBeenCalledWith([
      rawObservation,
    ]);
    expect(repoMock.upsertObservation).toHaveBeenCalledWith(
      transformedObservation,
    );
    expect(inserted).toBe(1);
  });
```

- Add a new test for per-row error isolation (previously untested):

```ts
  it("continues past a failed observation and counts only successes", async () => {
    jest.spyOn(Logger.prototype, "warn").mockImplementation();
    fetcherMock.fetchRareObservations.mockResolvedValue([rawObservation]);
    transformerMock.transformObservations.mockReturnValue([
      transformedObservation,
      { ...transformedObservation, subId: "sub-2" },
    ]);
    repoMock.upsertObservation.mockRejectedValueOnce(new Error("db down"));

    const inserted = await service.ingestRegion("US-WA");

    expect(inserted).toBe(1);
  });
```

(Add `import { Logger } from "@nestjs/common";` to the spec's imports.)

- [ ] **Step 4: Run tests**

Run: `pnpm check-types && pnpm test ingest`
Expected: PASS (repository 3 tests, service 3 tests, fetcher, transformer).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(ingest): fold location upsert into upsertObservation, atomically

ObservationRepository has one public method; IngestService no longer
knows the schema is normalized into two tables. Behavior change: the
location+observation write is now a single transaction."
```

---

### Task 6: Domain `Observation` type — translation moves to the transformer

The transformer becomes the eBird→domain line: field renames (`subnational2Name`→`county`, `locationPrivate`→`isPrivate`, …), date parsing, and `howMany` defaulting all happen there. The repository becomes a 1:1 field-to-column mapper. `TransformedEBirdObservation` and `EBirdMediaCounts` are deleted.

**Files:**
- Create: `src/features/ingest/observation.interface.ts`
- Modify: `src/features/ingest/ebird.transformer.ts`
- Modify: `src/features/ingest/ebird.schema.ts`
- Modify: `src/features/ingest/observation.repository.ts`
- Modify: `src/features/ingest/__tests__/ebird.transformer.spec.ts`
- Modify: `src/features/ingest/__tests__/observation.repository.spec.ts`
- Modify: `src/features/ingest/__tests__/ingest.service.spec.ts`
- Modify: `src/features/ingest/ingest.service.ts` (type import only)

**Interfaces:**
- Produces: `Observation` (below) from `./observation.interface`; `EBirdTransformer.transformObservations(raw: EBirdObservation[]): Observation[]`; `ObservationRepository.upsertObservation(data: Observation): Promise<void>`; `IngestService` internals use `Observation`.

- [ ] **Step 1: Write the domain type**

Create `src/features/ingest/observation.interface.ts`:

```ts
/**
 * A domain Observation: one species sighting on one eBird checklist,
 * deduped per species × checklist with media counts tallied (CONTEXT.md).
 * This is the transformer's output — everything downstream of the
 * transformer speaks these field names, not eBird's.
 */
export interface Observation {
  audioCount: number;
  comName: string;
  county: string;
  countyCode: string;
  hasComments: boolean;
  howMany: number;
  isPrivate: boolean;
  lat: number;
  lng: number;
  locId: string;
  locationName: string;
  obsDt: Date;
  obsReviewed: boolean;
  obsValid: boolean;
  photoCount: number;
  presenceNoted: boolean;
  sciName: string;
  speciesCode: string;
  state: string;
  stateCode: string;
  subId: string;
  videoCount: number;
}
```

(Deliberately dropped from the domain type because nothing persists or reads them: `checklistId`, `countryCode`, `countryName`, `firstName`, `lastName`, `userDisplayName`, `obsId`, `hasRichMedia`, `evidence`.)

- [ ] **Step 2: Update the transformer spec (failing first)**

In `src/features/ingest/__tests__/ebird.transformer.spec.ts`, replace the assertion block of the existing test and add a translation test:

```ts
    expect(first).toMatchObject({
      audioCount: 1,
      comName: "Common Loon",
      photoCount: 1,
      presenceNoted: true,
      videoCount: 0,
    });
  });

  it("translates eBird vocabulary into domain fields", () => {
    const [result] = transformer.transformObservations([baseObservation]);

    expect(result).toMatchObject({
      county: "King",
      countyCode: "US-WA-033",
      howMany: 2,
      isPrivate: false,
      locationName: "Lake Union",
      state: "Washington",
      stateCode: "US-WA",
    });
    expect(result.obsDt).toEqual(new Date("2024-01-01T10:00:00Z"));
    expect(result).not.toHaveProperty("subnational1Name");
    expect(result).not.toHaveProperty("evidence");
  });

  it("defaults howMany to zero when eBird omits it", () => {
    const [result] = transformer.transformObservations([
      { ...baseObservation, howMany: undefined },
    ]);

    expect(result.howMany).toBe(0);
  });
```

Run: `pnpm test ebird.transformer`
Expected: FAIL — `county`/`locationName` etc. undefined on the output.

- [ ] **Step 3: Implement the transformer boundary**

Replace `src/features/ingest/ebird.transformer.ts` with:

```ts
import { Injectable } from "@nestjs/common";
import type { EBirdObservation } from "./ebird.schema";
import type { Observation } from "./observation.interface";

@Injectable()
export class EBirdTransformer {
  /**
   * The eBird→domain translation line: dedupes reports per
   * species × checklist, tallies media evidence into counts, and renames
   * vendor vocabulary to domain vocabulary. Everything downstream speaks
   * Observation, not eBird.
   */
  transformObservations(raw: EBirdObservation[]): Observation[] {
    const reduced = raw.reduce((acc, row) => {
      const key = `${row.speciesCode}-${row.subId}`;
      const existing = acc.get(key);

      if (existing) {
        existing.audioCount += row.evidence === "A" ? 1 : 0;
        existing.photoCount += row.evidence === "P" ? 1 : 0;
        existing.videoCount += row.evidence === "V" ? 1 : 0;
        existing.presenceNoted = existing.presenceNoted || row.presenceNoted;
      } else {
        acc.set(key, this.toObservation(row));
      }

      return acc;
    }, new Map<string, Observation>());
    return Array.from(reduced.values());
  }

  private toObservation(row: EBirdObservation): Observation {
    return {
      audioCount: row.evidence === "A" ? 1 : 0,
      comName: row.comName,
      county: row.subnational2Name,
      countyCode: row.subnational2Code,
      hasComments: row.hasComments,
      howMany: row.howMany ?? 0,
      isPrivate: row.locationPrivate,
      lat: row.lat,
      lng: row.lng,
      locId: row.locId,
      locationName: row.locName,
      obsDt: new Date(row.obsDt),
      obsReviewed: row.obsReviewed,
      obsValid: row.obsValid,
      photoCount: row.evidence === "P" ? 1 : 0,
      presenceNoted: row.presenceNoted,
      sciName: row.sciName,
      speciesCode: row.speciesCode,
      state: row.subnational1Name,
      stateCode: row.subnational1Code,
      subId: row.subId,
      videoCount: row.evidence === "V" ? 1 : 0,
    };
  }
}
```

In `src/features/ingest/ebird.schema.ts`: delete the `EBirdMediaCounts` interface and the `TransformedEBirdObservation` type (keep `RawEBirdObservationSchema` and `EBirdObservation`).

- [ ] **Step 4: Point the repository and service at `Observation`**

In `src/features/ingest/observation.repository.ts`: replace the `TransformedEBirdObservation` import with `import type { Observation } from "./observation.interface";`, change the signature to `upsertObservation(data: Observation)`, and update the field mapping to 1:1 domain names:

```ts
      await tx
        .insert(locations)
        .values({
          county: data.county,
          countyCode: data.countyCode,
          id: data.locId,
          isPrivate: data.isPrivate,
          lat: data.lat,
          lng: data.lng,
          name: data.locationName,
          state: data.state,
          stateCode: data.stateCode,
        })
        .onConflictDoUpdate({
          set: {
            county: data.county,
            countyCode: data.countyCode,
            isPrivate: data.isPrivate,
            lastUpdated: new Date(),
            lat: data.lat,
            lng: data.lng,
            name: data.locationName,
            state: data.state,
            stateCode: data.stateCode,
          },
          target: [locations.id],
        });
```

…and in the observations insert/update, `howMany: data.howMany ?? 0` → `howMany: data.howMany` and `obsDt: new Date(data.obsDt)` → `obsDt: data.obsDt` (both defaulting/parsing moved to the transformer). All other observation fields are unchanged names.

In `src/features/ingest/ingest.service.ts`: the import
`import type { EBirdObservation, TransformedEBirdObservation } from "./ebird.schema";` becomes
`import type { EBirdObservation } from "./ebird.schema";` (the `TransformedEBirdObservation` mention in the file was only the import; the loop variable is inferred).

- [ ] **Step 5: Update the repository and service spec fixtures**

`src/features/ingest/__tests__/observation.repository.spec.ts` — replace the fixture and its type import:

```ts
import type { Observation } from "../observation.interface";

const baseObservation: Observation = {
  audioCount: 0,
  comName: "Vermilion Flycatcher",
  county: "Santa Clara",
  countyCode: "US-CA-085",
  hasComments: false,
  howMany: 1,
  isPrivate: false,
  lat: 37.3,
  lng: -122.0,
  locId: "L001",
  locationName: "Test Hotspot",
  obsDt: new Date("2026-07-07T09:00:00Z"),
  obsReviewed: false,
  obsValid: false,
  photoCount: 0,
  presenceNoted: false,
  sciName: "Pyrocephalus rubinus",
  speciesCode: "verfly",
  state: "California",
  stateCode: "US-CA",
  subId: "S001",
  videoCount: 0,
};
```

…and in the "propagates location renames" test, `locationPrivate: true, locName: "New Name"` → `isPrivate: true, locationName: "New Name"`.

`src/features/ingest/__tests__/ingest.service.spec.ts` — `transformedObservation` becomes an `Observation` (import the type from `../observation.interface`; delete the `TransformedEBirdObservation` import):

```ts
  const transformedObservation: Observation = {
    audioCount: 0,
    comName: "Common Loon",
    county: "King",
    countyCode: "US-WA-033",
    hasComments: false,
    howMany: 2,
    isPrivate: false,
    lat: 47.6062,
    lng: -122.3321,
    locId: "loc-1",
    locationName: "Lake Union",
    obsDt: new Date("2024-01-01T10:00:00Z"),
    obsReviewed: true,
    obsValid: true,
    photoCount: 1,
    presenceNoted: false,
    sciName: "Gavia immer",
    speciesCode: "comloo",
    state: "Washington",
    stateCode: "US-WA",
    subId: "sub-1",
    videoCount: 0,
  };
```

- [ ] **Step 6: Run the full suite**

Run: `pnpm check-types && pnpm test`
Expected: clean tsc; whole suite PASS. Also verify the type is really gone: `grep -rn "TransformedEBirdObservation" src` prints nothing.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor(ingest): domain Observation type; eBird->domain translation moves to the transformer

The transformer is now the anti-corruption line (field renames, date
parsing, howMany default). ObservationRepository maps domain fields to
columns 1:1. TransformedEBirdObservation deleted."
```

---

### Task 7: Co-locate all specs next to their sources

Nest CLI convention: `foo.service.spec.ts` sits beside `foo.service.ts`. Jest's `testRegex: ".*\\.spec\\.ts$"` matches both layouts, so this is `git mv` + relative-import fixes only.

**Files (every move):**

```bash
git mv src/core/config/__tests__/config.schema.spec.ts                       src/core/config/config.schema.spec.ts
git mv src/core/drizzle/__tests__/migrations.spec.ts                         src/core/drizzle/migrations.spec.ts
git mv src/discord/__tests__/message-sender.service.spec.ts                  src/discord/message-sender.service.spec.ts
git mv src/discord/__tests__/necord.config.spec.ts                           src/discord/necord.config.spec.ts
git mv src/discord/common/filters/__tests__/command-exception.filter.spec.ts src/discord/common/filters/command-exception.filter.spec.ts
git mv src/features/dispatch/__tests__/alert-queue.repository.spec.ts        src/features/dispatch/alert-queue.repository.spec.ts
git mv src/features/dispatch/__tests__/alert-queue.service.spec.ts           src/features/dispatch/alert-queue.service.spec.ts
git mv src/features/ingest/__tests__/ebird.fetcher.spec.ts                   src/features/ingest/ebird.fetcher.spec.ts
git mv src/features/ingest/__tests__/ebird.transformer.spec.ts               src/features/ingest/ebird.transformer.spec.ts
git mv src/features/ingest/__tests__/ingest.service.spec.ts                  src/features/ingest/ingest.service.spec.ts
git mv src/features/ingest/__tests__/observation.repository.spec.ts          src/features/ingest/observation.repository.spec.ts
git mv src/features/filters/__tests__/filters.reactions.spec.ts              src/features/filters/filters.reactions.spec.ts
git mv src/features/filters/__tests__/filters.repository.spec.ts             src/features/filters/filters.repository.spec.ts
git mv src/features/jobs/__tests__/bootstrap.service.spec.ts                 src/features/jobs/bootstrap.service.spec.ts
git mv src/features/jobs/__tests__/dispatch.job.spec.ts                      src/features/jobs/dispatch.job.spec.ts
git mv src/features/jobs/__tests__/ingest.job.spec.ts                        src/features/jobs/ingest.job.spec.ts
git mv src/features/subscriptions/__tests__/subscriptions.commands.spec.ts   src/features/subscriptions/subscriptions.commands.spec.ts
git mv src/features/subscriptions/__tests__/subscriptions.module.spec.ts     src/features/subscriptions/subscriptions.module.spec.ts
git mv src/features/subscriptions/__tests__/subscriptions.repository.spec.ts src/features/subscriptions/subscriptions.repository.spec.ts
git mv src/features/subscriptions/__tests__/subscriptions.service.spec.ts    src/features/subscriptions/subscriptions.service.spec.ts
```

- [ ] **Step 1: Move all specs (commands above)**

- [ ] **Step 2: Fix relative imports in every moved spec**

In each moved file, imports of the form `from "../<name>"` become `from "./<name>"` (the `@/...` alias imports need no change). Mechanical check + edit per file, e.g. in `src/features/dispatch/alert-queue.service.spec.ts`: `from "../alert-queue.service"` → `from "./alert-queue.service"`, `from "../alert-queue.repository"` → `from "./alert-queue.repository"`.

Special check: `src/core/drizzle/migrations.spec.ts` — if it builds filesystem paths from `__dirname` (e.g. to load `drizzle/` migration files), adjust those paths for the one-directory-up move. Read the file before assuming.

Then remove the empty dirs: `find src -type d -name __tests__ -empty -delete` and confirm `find src -type d -name __tests__` prints nothing.

- [ ] **Step 3: Full suite**

Run: `pnpm check-types && pnpm test`
Expected: same test count as before the move (21 spec files), all PASS.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor(tests): co-locate specs beside sources per Nest convention"
```

---

### Task 8: Changeset + final verification

**Files:**
- Create: `.changeset/pipeline-boundaries.md` (repo root)

- [ ] **Step 1: Write the changeset**

Create `/Users/andrewbeamer/Repos/ScrubJay/.changeset/pipeline-boundaries.md`:

```md
---
"scrubjay-discord": patch
---

Pipeline boundary refactor. Dispatch: send-then-record protocol moves into
DispatchService (replacing EBirdDispatcherService); a failed Discord send is
no longer recorded as delivered — the alert stays pending and retries until
it ages out of the dispatch window. Ingest: features/ebird becomes
features/ingest; location+observation persistence is one transactional
upsertObservation; eBird→domain field translation moves into the
transformer behind a domain Observation type. File names now follow the
NestJS <name>.<role>.ts convention and specs are co-located with sources.
```

- [ ] **Step 2: Full verification from the repo root**

Run: `cd /Users/andrewbeamer/Repos/ScrubJay && pnpm turbo check-types test lint --filter=scrubjay-discord` (or run `pnpm check-types && pnpm test && pnpm lint` inside the app if turbo tasks aren't configured for all three).
Expected: all green. Also `pnpm biome check apps/scrubjay-discord/src` from the root if lint doesn't cover Biome.

- [ ] **Step 3: Commit**

```bash
git add .changeset/pipeline-boundaries.md
git commit -m "chore: changeset for pipeline boundary refactor"
```

---

## Self-Review Notes

- **Spec coverage:** dispatch inversion (Tasks 1–3), ingest fold-in + domain boundary (Tasks 4–6), naming conventions incl. spec co-location (Tasks 1, 4, 7), changeset (Task 8). The four announced behavior changes are each implemented and tested: failed-send-stays-pending (Task 3 spec), atomic upsert (Task 5, transaction), required `since` (Task 3), dropped `howMany` stat (Task 2).
- **Type consistency:** `DispatchPlan` produced in Task 2 = consumed in Task 3. `Observation` produced in Task 6 Step 1 = consumed in Steps 3–5. `upsertObservation(data: TransformedEBirdObservation)` in Task 5 is intentionally re-typed to `Observation` in Task 6.
- **Known coupling:** `BootstrapService.onModuleInit` passes `PendingEBirdAlert[]` to `markSent(SentAlert[])` — compiles structurally (superset), unchanged by this plan.
