# Dispatch Semantics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every alert outcome durable and observable — per-plan delivery recording with Discord error classification, a dispatch overlap guard, and an expiry sweep — per `docs/superpowers/specs/2026-07-09-dispatch-semantics-design.md`.

**Architecture:** The `deliveries` table gains a `status` column (`sent | failed | expired | suppressed`) and becomes an outcome ledger. `DispatchService` records after each plan (not batched), classifies `DiscordAPIError` codes into permanent vs transient, deactivates subscriptions on Unknown Channel, and sweeps aged-out undelivered alerts into `expired` rows. `DispatchJob` gains an in-process re-entrancy guard.

**Tech Stack:** NestJS 11, drizzle-orm 0.45 + pg, drizzle-kit migrations (checked into `src/drizzle/`, applied via `migrate()` at startup and by the test template DB), Vitest 4, discord.js 14.

## Global Constraints

- All work in `apps/scrubjay-discord`; run commands from that directory unless noted.
- Test: `pnpm run test` (needs local Postgres from docker-compose, already running). Types: `pnpm run check-types`. Lint: `pnpm -w run format-and-lint` from the workspace ROOT (`:fix` variant to autofix). Biome enforces **sorted object keys**.
- Commit style: conventional commits scoped `fix(scrubjay-discord):` / `feat(scrubjay-discord):`. Every commit message ends with the trailer line:
  `Claude-Session: https://claude.ai/code/session_01K4zVVKgP6NuoPuH4yM1j5C`
- Do NOT push. Do NOT touch files outside `apps/scrubjay-discord`.
- The pending-alert definition (`pendingWhere` in `alert-queue.repository.ts`) must NOT change: any delivery row — regardless of status — excludes an alert from pending.
- Send-then-record order is a spec decision (at-least-once). Never reorder to record-then-send.
- Single-instance deployment is assumed; the overlap guard is in-process by design (spec §3).

---

### Task 1: `deliveries` status + detail columns (schema & migration)

**Files:**
- Modify: `src/core/drizzle/drizzle.schema.ts` (deliveries table, ~line 116)
- Create: `src/drizzle/0005_delivery_status.sql` (generated)
- Test: `src/features/dispatch/alert-queue.repository.spec.ts`

**Interfaces:**
- Consumes: existing `deliveries` table.
- Produces: `deliveryStatuses` const and `DeliveryStatus` type exported from `drizzle.schema.ts`; columns `deliveries.status` (text, not null, default `'sent'`, CHECK-constrained) and `deliveries.detail` (text, nullable). Later tasks import `DeliveryStatus` from `@/core/drizzle/drizzle.schema`.

- [ ] **Step 1: Write the failing tests**

Add to the top-level `describe("AlertQueueRepository")` block in `src/features/dispatch/alert-queue.repository.spec.ts` (uses the existing `db`, `pool`, `seedDelivery`, `truncateAll` setup; add `describe` block after the `"query plan"` block):

```ts
describe("delivery status column", () => {
  it("defaults status to 'sent' and detail to null", async () => {
    await seedDelivery(db);

    const [row] = await db.db.select().from(deliveries);
    expect(row.status).toBe("sent");
    expect(row.detail).toBeNull();
  });

  it("rejects statuses outside the enum at the DB level", async () => {
    await expect(
      db.db.execute(
        sql`INSERT INTO deliveries (alert_id, channel_id, alert_kind, status)
            VALUES ('verfly:S001', 'CH1', 'ebird', 'bogus')`,
      ),
    ).rejects.toThrow(/deliveries_status_check/);
  });
});
```

(`deliveries` and `sql` are already imported in this spec file.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm run test -- alert-queue.repository`
Expected: FAIL — `row.status` is undefined (column does not exist) and the raw insert fails with "column \"status\" of relation \"deliveries\" does not exist" instead of the CHECK error.

- [ ] **Step 3: Update the schema**

In `src/core/drizzle/drizzle.schema.ts`, add above the `deliveries` table:

```ts
export const deliveryStatuses = [
  "sent",
  "failed",
  "expired",
  "suppressed",
] as const;
export type DeliveryStatus = (typeof deliveryStatuses)[number];
```

Change the `deliveries` table to (keys sorted for biome; note the added `check` import from `drizzle-orm/pg-core`):

```ts
export const deliveries = pgTable(
  "deliveries",
  {
    alertId: text("alert_id").notNull(),
    channelId: text("channel_id").notNull(),
    // Discord error code/message for 'failed' rows; null otherwise.
    detail: text("detail"),
    id: serial("id").primaryKey(),
    kind: text("alert_kind").notNull(), // 'ebird' (rss existed historically; rows purged in 0004)
    sentAt: timestamp("sent_at").defaultNow(),
    status: text("status", { enum: deliveryStatuses })
      .notNull()
      .default("sent"),
  },
  (t) => [
    uniqueIndex("deliveries_unique_idx").on(t.kind, t.alertId, t.channelId),
    index("deliveries_channel_idx").on(t.channelId),
    check(
      "deliveries_status_check",
      sql`${t.status} in ('sent', 'failed', 'expired', 'suppressed')`,
    ),
  ],
);
```

Add `check` to the existing `drizzle-orm/pg-core` import.

- [ ] **Step 4: Generate the migration**

```bash
set -a && source .env && set +a
pnpm exec drizzle-kit generate --name delivery_status
```

Expected: creates `src/drizzle/0005_delivery_status.sql` plus a new snapshot under `src/drizzle/meta/`. Verify the SQL contains exactly (order may vary):

```sql
ALTER TABLE "deliveries" ADD COLUMN "detail" text;
ALTER TABLE "deliveries" ADD COLUMN "status" text DEFAULT 'sent' NOT NULL;
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_status_check" CHECK ("deliveries"."status" in ('sent', 'failed', 'expired', 'suppressed'));
```

The `DEFAULT 'sent' NOT NULL` backfills all existing rows as `sent` (spec test case 8). If drizzle-kit did not emit the CHECK constraint, add the `ADD CONSTRAINT` line to the generated SQL by hand.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm run test -- alert-queue.repository`
Expected: PASS (the test template DB re-runs migrations via global-setup; if the template appears stale, drop it: `docker compose exec -T postgres psql -U scrubjay -c 'DROP DATABASE IF EXISTS scrubjay_template'` from the repo root, then rerun).

- [ ] **Step 6: Full gate and commit**

Run: `pnpm run test && pnpm run check-types` — all pass.

```bash
git add src/core/drizzle/drizzle.schema.ts src/drizzle/ src/features/dispatch/alert-queue.repository.spec.ts
git commit -m "feat(scrubjay-discord): add status and detail columns to deliveries"
```

---

### Task 2: `AlertQueue.record()` replaces `markSent()`; backfill records `suppressed`

**Files:**
- Modify: `src/features/dispatch/alert-queue.service.ts`
- Modify: `src/features/dispatch/alert-queue.repository.ts` (`DeliveryRow`, `insertDeliveries` callers, `backfillDeliveries`)
- Modify: `src/features/dispatch/dispatch.service.ts` (rename only — keep single `record(..., "sent")` call for now; Task 3 restructures the loop)
- Modify: `src/features/jobs/bootstrap.service.ts` (call `record(pending, "suppressed")`)
- Test: `src/features/dispatch/dispatch.service.spec.ts`, `src/features/jobs/bootstrap.service.spec.ts`, `src/features/dispatch/alert-queue.repository.spec.ts`, `src/features/dispatch/alert-queue.service.spec.ts` (if present — update mock method names)

**Interfaces:**
- Consumes: `DeliveryStatus` from Task 1.
- Produces:
  - `AlertQueue.record(alerts: AlertRef[], status: DeliveryStatus, detail?: string): Promise<void>` — replaces `markSent` (no back-compat alias).
  - `export type AlertRef = { speciesCode: string; subId: string; channelId: string }` — renames `SentAlert` (structurally unchanged, so `PendingEBirdAlert[]` still satisfies it).
  - `DeliveryRow` gains required `status: DeliveryStatus` and optional `detail?: string | null`.
  - Backfill delivery rows now carry `status: "suppressed"`.

- [ ] **Step 1: Write/adjust the failing tests**

In `src/features/dispatch/dispatch.service.spec.ts`: rename the mock key `markSent` → `record` (both the object literal and every assertion), and update the two recording assertions to expect the status argument:

```ts
const alertQueueMock = { pendingEBirdAlerts: vi.fn(), record: vi.fn() };
// beforeEach: alertQueueMock.record.mockReset().mockResolvedValue(undefined);

// in "sends one message per plan and records every sent alert":
expect(alertQueueMock.record).toHaveBeenCalledWith(
  [
    { channelId: "CH1", speciesCode: "verfly", subId: "S001" },
    { channelId: "CH1", speciesCode: "verfly", subId: "S002" },
    { channelId: "CH2", speciesCode: "verfly", subId: "S001" },
  ],
  "sent",
);

// in "leaves alerts pending when their send fails, still recording the rest":
expect(alertQueueMock.record).toHaveBeenCalledWith(
  [{ channelId: "CH2", speciesCode: "verfly", subId: "S001" }],
  "sent",
);
```

In `src/features/jobs/bootstrap.service.spec.ts`: rename the mock key `markSent` → `record` (object literal, `beforeEach` reset, and the B6 test's `mockRejectedValue`), and add one assertion to the success-path test ("unblocks jobs after a successful bootstrap"):

```ts
expect(alertQueueMock.record).toHaveBeenCalledWith([], "suppressed");
```

In `src/features/dispatch/alert-queue.repository.spec.ts`, inside the existing `"backfillDeliveries"` describe block's first test ("records every currently-pending alert as delivered without sending"), add an assertion that backfilled rows are suppressed:

```ts
const rows = await db.db.select().from(deliveries);
expect(rows.every((row) => row.status === "suppressed")).toBe(true);
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm run test -- dispatch.service bootstrap.service alert-queue.repository`
Expected: FAIL — `record` is not a function on the real services; backfill rows read back as `'sent'`.

- [ ] **Step 3: Implement**

`src/features/dispatch/alert-queue.repository.ts` — update `DeliveryRow` and `backfillDeliveries`:

```ts
import type { DeliveryStatus } from "@/core/drizzle/drizzle.schema";

export type DeliveryRow = {
  alertId: string;
  channelId: string;
  detail?: string | null;
  kind: "ebird";
  status: DeliveryStatus;
};
```

In `backfillDeliveries`, the insert becomes:

```ts
await db
  .insert(deliveries)
  .values(
    pending.map((row) => ({
      ...row,
      kind: "ebird" as const,
      // Backfilled alerts were never actually sent — record them as
      // suppressed so delivery stats only count real sends.
      status: "suppressed" as const,
    })),
  )
  .onConflictDoNothing();
```

`src/features/dispatch/alert-queue.service.ts` — rename the type, replace `markSent`:

```ts
import type { DeliveryStatus } from "@/core/drizzle/drizzle.schema";

const RECORD_BATCH_SIZE = 100;

export type AlertRef = {
  speciesCode: string;
  subId: string;
  channelId: string;
};

/**
 * Record a terminal outcome for alerts. Idempotent (unique on
 * kind+alertId+channelId); owns the alertId format — callers never build it.
 * Every status is terminal: any delivery row excludes the alert from pending.
 */
async record(
  alerts: AlertRef[],
  status: DeliveryStatus,
  detail?: string,
): Promise<void> {
  for (let i = 0; i < alerts.length; i += RECORD_BATCH_SIZE) {
    const batch = alerts.slice(i, i + RECORD_BATCH_SIZE).map((alert) => ({
      alertId: `${alert.speciesCode}:${alert.subId}`,
      channelId: alert.channelId,
      detail: detail ?? null,
      kind: "ebird" as const,
      status,
    }));
    await this.repository.insertDeliveries(batch);
  }
}
```

Delete `markSent` and the `SentAlert` type (and the now-unused `MARK_SENT_BATCH_SIZE`).

`src/features/dispatch/dispatch.service.ts` — mechanical rename only (Task 3 restructures the loop): import `AlertRef` instead of `SentAlert`, rename `toSentAlert` → `toAlertRef`, and change the final call to `await this.alertQueue.record(sent, "sent");`.

`src/features/jobs/bootstrap.service.ts` — replace the markSent call and log line:

```ts
const pending = await this.alertQueue.pendingEBirdAlerts();
await this.alertQueue.record(pending, "suppressed");
this.logger.log(
  `Suppressed ${pending.length} pre-existing alerts (bootstrap mode).`,
);
```

Also fix the EXPLAIN smoke test's `insertDeliveries` call in `alert-queue.repository.spec.ts` (now type-errors on the required `status`): add `status: "sent" as const` to the mapped object.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm run test`
Expected: all pass. `grep -rn "markSent\|SentAlert" src/` returns nothing.

- [ ] **Step 5: Commit**

```bash
git add src/features/dispatch/ src/features/jobs/
git commit -m "feat(scrubjay-discord): generalize markSent to record() with delivery statuses"
```

---

### Task 3: Per-plan recording with Discord error classification + dead-channel deactivation

**Files:**
- Create: `src/features/dispatch/discord-error.ts`
- Create: `src/features/dispatch/discord-error.spec.ts`
- Modify: `src/features/dispatch/dispatch.service.ts` (restructure send loop)
- Modify: `src/features/dispatch/alert-queue.service.ts` + `alert-queue.repository.ts` (add `deactivateChannel`)
- Test: `src/features/dispatch/dispatch.service.spec.ts`, `src/features/dispatch/alert-queue.repository.spec.ts`

**Interfaces:**
- Consumes: `record(alerts, status, detail?)` from Task 2.
- Produces:
  - `classifySendError(err: unknown): SendFailure` where `SendFailure = { kind: "permanent"; code: number; channelGone: boolean } | { kind: "transient" }`.
  - `AlertQueue.deactivateChannel(channelId: string): Promise<number>` (returns count of deactivated subscriptions), backed by `AlertQueueRepository.deactivateChannelSubscriptions`. It lives in the dispatch module (not SubscriptionsRepository) because SubscriptionsModule already imports DispatchModule — the reverse import would be a cycle; deactivation is a dispatch-outcome side effect.

- [ ] **Step 1: Write the failing classifier tests**

Create `src/features/dispatch/discord-error.spec.ts`:

```ts
import { DiscordAPIError } from "discord.js";
import { describe, expect, it } from "vitest";
import { classifySendError } from "./discord-error";

function apiError(code: number): DiscordAPIError {
  return new DiscordAPIError(
    { code, message: "boom" },
    code,
    404,
    "POST",
    "https://discord.com/api",
    { body: undefined, files: undefined },
  );
}

describe("classifySendError", () => {
  it("classifies Unknown Channel as permanent and gone", () => {
    expect(classifySendError(apiError(10003))).toEqual({
      channelGone: true,
      code: 10003,
      kind: "permanent",
    });
  });

  it("classifies Missing Access and Missing Permissions as permanent, not gone", () => {
    expect(classifySendError(apiError(50001))).toEqual({
      channelGone: false,
      code: 50001,
      kind: "permanent",
    });
    expect(classifySendError(apiError(50013))).toEqual({
      channelGone: false,
      code: 50013,
      kind: "permanent",
    });
  });

  it("classifies other Discord errors and non-Discord errors as transient", () => {
    expect(classifySendError(apiError(500))).toEqual({ kind: "transient" });
    expect(classifySendError(new Error("socket hang up"))).toEqual({
      kind: "transient",
    });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm run test -- discord-error`
Expected: FAIL — module `./discord-error` not found.

- [ ] **Step 3: Implement the classifier**

Create `src/features/dispatch/discord-error.ts`:

```ts
import { DiscordAPIError } from "discord.js";

/**
 * Classification of a failed Discord send (spec §2). Permanent errors get a
 * 'failed' delivery row and are never retried; `channelGone` additionally
 * deactivates the channel's subscriptions. Everything else is transient:
 * no row is written, so the alert stays pending and retries next tick.
 * discord.js queues/retries 429s internally, so they never surface here.
 */
export type SendFailure =
  | { kind: "permanent"; code: number; channelGone: boolean }
  | { kind: "transient" };

const UNKNOWN_CHANNEL = 10003;
const MISSING_ACCESS = 50001;
const MISSING_PERMISSIONS = 50013;

export function classifySendError(err: unknown): SendFailure {
  if (!(err instanceof DiscordAPIError) || typeof err.code !== "number") {
    return { kind: "transient" };
  }
  if (err.code === UNKNOWN_CHANNEL) {
    return { channelGone: true, code: err.code, kind: "permanent" };
  }
  if (err.code === MISSING_ACCESS || err.code === MISSING_PERMISSIONS) {
    return { channelGone: false, code: err.code, kind: "permanent" };
  }
  return { kind: "transient" };
}
```

Run: `pnpm run test -- discord-error` — PASS.

- [ ] **Step 4: Write the failing dispatch-service tests**

Add to `src/features/dispatch/dispatch.service.spec.ts`. The mock gains `deactivateChannel`:

```ts
const alertQueueMock = {
  deactivateChannel: vi.fn(),
  pendingEBirdAlerts: vi.fn(),
  record: vi.fn(),
};
// beforeEach: alertQueueMock.deactivateChannel.mockReset().mockResolvedValue(1);
```

Add the same `apiError` helper used in `discord-error.spec.ts` (duplicate the 10-line helper into this file), plus these tests:

```ts
it("records each plan immediately after its send (per-plan, not batched)", async () => {
  alertQueueMock.pendingEBirdAlerts.mockResolvedValue([
    makeAlert({ channelId: "CH1" }),
    makeAlert({ channelId: "CH2" }),
  ]);
  const calls: string[] = [];
  senderMock.send.mockImplementation(async (channelId: string) => {
    calls.push(`send:${channelId}`);
  });
  alertQueueMock.record.mockImplementation(async (alerts: unknown[]) => {
    calls.push(`record:${(alerts as { channelId: string }[])[0].channelId}`);
  });

  await service.dispatchSince(since);

  expect(calls).toEqual(["send:CH1", "record:CH1", "send:CH2", "record:CH2"]);
});

it("records a permanent permission failure as failed without deactivating", async () => {
  alertQueueMock.pendingEBirdAlerts.mockResolvedValue([makeAlert()]);
  senderMock.send.mockRejectedValue(apiError(50013));

  await service.dispatchSince(since);

  expect(alertQueueMock.record).toHaveBeenCalledWith(
    [{ channelId: "CH1", speciesCode: "verfly", subId: "S001" }],
    "failed",
    "discord:50013",
  );
  expect(alertQueueMock.deactivateChannel).not.toHaveBeenCalled();
});

it("deactivates the channel's subscriptions on Unknown Channel", async () => {
  alertQueueMock.pendingEBirdAlerts.mockResolvedValue([makeAlert()]);
  senderMock.send.mockRejectedValue(apiError(10003));

  await service.dispatchSince(since);

  expect(alertQueueMock.record).toHaveBeenCalledWith(
    [{ channelId: "CH1", speciesCode: "verfly", subId: "S001" }],
    "failed",
    "discord:10003",
  );
  expect(alertQueueMock.deactivateChannel).toHaveBeenCalledWith("CH1");
});

it("records nothing for transient failures so the alerts stay pending", async () => {
  alertQueueMock.pendingEBirdAlerts.mockResolvedValue([makeAlert()]);
  senderMock.send.mockRejectedValue(new Error("socket hang up"));

  await service.dispatchSince(since);

  expect(alertQueueMock.record).not.toHaveBeenCalled();
  expect(alertQueueMock.deactivateChannel).not.toHaveBeenCalled();
});
```

Also UPDATE the existing test "leaves alerts pending when their send fails, still recording the rest": its `mockRejectedValueOnce(new Error("channel gone"))` is transient, so with per-plan recording the assertion becomes:

```ts
expect(alertQueueMock.record).toHaveBeenCalledTimes(1);
expect(alertQueueMock.record).toHaveBeenCalledWith(
  [{ channelId: "CH2", speciesCode: "verfly", subId: "S001" }],
  "sent",
);
```

And the existing "sends one message per plan and records every sent alert" test: `record` is now called once per plan (twice), each with that plan's alerts and `"sent"` — update to:

```ts
expect(alertQueueMock.record).toHaveBeenCalledTimes(2);
expect(alertQueueMock.record).toHaveBeenNthCalledWith(
  1,
  [
    { channelId: "CH1", speciesCode: "verfly", subId: "S001" },
    { channelId: "CH1", speciesCode: "verfly", subId: "S002" },
  ],
  "sent",
);
expect(alertQueueMock.record).toHaveBeenNthCalledWith(
  2,
  [{ channelId: "CH2", speciesCode: "verfly", subId: "S001" }],
  "sent",
);
```

- [ ] **Step 5: Run to verify failure**

Run: `pnpm run test -- dispatch.service`
Expected: FAIL — recording is still batched at the end; no classification, no deactivation.

- [ ] **Step 6: Implement the new send loop and deactivation**

`src/features/dispatch/alert-queue.repository.ts` — add:

```ts
/**
 * Deactivate every active subscription for a channel. Lives here (not in
 * SubscriptionsRepository) because dispatch owns delivery outcomes and the
 * reverse module import would be a cycle. Returns the number deactivated.
 */
async deactivateChannelSubscriptions(channelId: string): Promise<number> {
  const rows = await this.drizzle.db
    .update(channelEBirdSubscriptions)
    .set({ active: false })
    .where(
      and(
        eq(channelEBirdSubscriptions.channelId, channelId),
        eq(channelEBirdSubscriptions.active, true),
      ),
    )
    .returning({ channelId: channelEBirdSubscriptions.channelId });
  return rows.length;
}
```

`src/features/dispatch/alert-queue.service.ts` — add:

```ts
/** Deactivate a dead channel's subscriptions (spec §2, Unknown Channel). */
async deactivateChannel(channelId: string): Promise<number> {
  return this.repository.deactivateChannelSubscriptions(channelId);
}
```

`src/features/dispatch/dispatch.service.ts` — replace `dispatchSince` (delete the `sent` accumulator):

```ts
async dispatchSince(since: Date): Promise<void> {
  const pending = await this.alertQueue.pendingEBirdAlerts(since);

  if (pending.length === 0) {
    this.logger.debug(`No new alerts since ${since.toISOString()}`);
    return;
  }

  let sentCount = 0;
  for (const plan of planEBirdAlerts(pending)) {
    const refs = plan.alerts.map(toAlertRef);
    try {
      await this.sender.send(plan.channelId, plan.message);
      // Record immediately: a crash now loses at most this one plan's
      // records instead of the whole tick's (at-least-once, spec §2).
      await this.alertQueue.record(refs, "sent");
      sentCount += refs.length;
    } catch (err) {
      await this.handleSendFailure(plan.channelId, refs, err);
    }
  }

  if (sentCount > 0) {
    this.logger.log(`Delivered ${sentCount} alerts`);
  }
}

private async handleSendFailure(
  channelId: string,
  refs: AlertRef[],
  err: unknown,
): Promise<void> {
  const failure = classifySendError(err);
  if (failure.kind === "transient") {
    this.logger.error(
      `Send failed for channel ${channelId}; alerts stay pending`,
      err instanceof Error ? err.stack : String(err),
    );
    return;
  }

  await this.alertQueue.record(refs, "failed", `discord:${failure.code}`);
  if (failure.channelGone) {
    const count = await this.alertQueue.deactivateChannel(channelId);
    this.logger.error(
      `Channel ${channelId} no longer exists; recorded ${refs.length} alerts as failed and deactivated ${count} subscription(s)`,
    );
  } else {
    this.logger.error(
      `Send permanently failed for channel ${channelId} (discord:${failure.code}); recorded ${refs.length} alerts as failed`,
    );
  }
}
```

Imports: `classifySendError` from `./discord-error`; `AlertRef` from `./alert-queue.service`. Rename helper `toSentAlert` → `toAlertRef` if not already done in Task 2.

Known limitation to preserve as-is: `MessageSenderService` throws a plain `Error` for a fetched-but-not-sendable channel; that classifies as transient and eventually lands in the Task 5 expiry sweep — recorded, not silent.

- [ ] **Step 7: Write the failing repository test for deactivation**

Add to `alert-queue.repository.spec.ts`:

```ts
describe("deactivateChannelSubscriptions", () => {
  it("deactivates only the given channel's active subscriptions", async () => {
    await seedSubscription(db, { channelId: "CH1" });
    await seedSubscription(db, { channelId: "CH1", stateCode: "US-WA", countyCode: "*" });
    await seedSubscription(db, { channelId: "CH2" });

    const count = await repository.deactivateChannelSubscriptions("CH1");

    expect(count).toBe(2);
    const rows = await db.db.select().from(channelEBirdSubscriptions);
    for (const row of rows) {
      expect(row.active).toBe(row.channelId === "CH2");
    }
  });
});
```

(Import `channelEBirdSubscriptions` from the schema in the spec file if not present.)

- [ ] **Step 8: Run all dispatch tests**

Run: `pnpm run test -- dispatch discord-error alert-queue`
Expected: PASS.

- [ ] **Step 9: Full gate and commit**

Run: `pnpm run test && pnpm run check-types` — all pass.

```bash
git add src/features/dispatch/
git commit -m "feat(scrubjay-discord): per-plan delivery recording with Discord error classification"
```

---

### Task 4: Dispatch overlap guard

**Files:**
- Modify: `src/features/jobs/dispatch.job.ts`
- Test: `src/features/jobs/dispatch.job.spec.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `DispatchJob.run()` is a no-op (debug log) while a previous invocation is still in flight.

- [ ] **Step 1: Write the failing test**

Add to `src/features/jobs/dispatch.job.spec.ts`:

```ts
it("skips a tick while the previous one is still running", async () => {
  let release!: () => void;
  dispatcherMock.dispatchSince.mockImplementation(
    () => new Promise<void>((resolve) => {
      release = resolve;
    }),
  );

  const first = job.run();
  await job.run(); // overlapping tick — must be a no-op

  expect(dispatcherMock.dispatchSince).toHaveBeenCalledTimes(1);

  release();
  await first;

  // The guard resets once the tick finishes.
  dispatcherMock.dispatchSince.mockResolvedValue(undefined);
  await job.run();
  expect(dispatcherMock.dispatchSince).toHaveBeenCalledTimes(2);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm run test -- dispatch.job`
Expected: FAIL — `dispatchSince` called 2 times at the first assertion.

- [ ] **Step 3: Implement the guard**

In `src/features/jobs/dispatch.job.ts`:

```ts
export class DispatchJob {
  private readonly logger = new Logger(DispatchJob.name);

  /**
   * Re-entrancy guard: @nestjs/schedule does not serialize overlapping cron
   * runs, and an overlapped tick would re-read pending alerts before the
   * running tick records them — double-sending every alert in the slow batch.
   * In-process only: this deployment is single-instance by design (spec §3).
   */
  private inFlight = false;

  constructor(
    private readonly dispatch: DispatchService,
    private readonly bootstrapService: BootstrapService,
  ) {}

  @Cron("*/1 * * * *")
  async run() {
    if (this.inFlight) {
      this.logger.debug("Previous dispatch tick still running; skipping");
      return;
    }
    this.inFlight = true;
    try {
      // Wait for bootstrap to complete before running
      await this.bootstrapService.waitForBootstrap();

      const since = new Date(Date.now() - 15 * 60 * 1000);
      this.logger.debug(
        `Running dispatch job for alerts since ${since.toISOString()}`,
      );
      await this.dispatch.dispatchSince(since);
    } catch (err) {
      this.logger.error(
        `Dispatch tick failed`,
        err instanceof Error ? err.stack : String(err),
      );
    } finally {
      this.inFlight = false;
    }
  }
}
```

- [ ] **Step 4: Run tests, then commit**

Run: `pnpm run test -- dispatch.job` — PASS. Then `pnpm run test && pnpm run check-types` — all pass.

```bash
git add src/features/jobs/dispatch.job.ts src/features/jobs/dispatch.job.spec.ts
git commit -m "fix(scrubjay-discord): guard dispatch cron against overlapping ticks"
```

---

### Task 5: Expiry sweep

**Files:**
- Modify: `src/features/dispatch/alert-queue.repository.ts` (add `sweepExpiredAlerts`; add `lte` to drizzle-orm imports)
- Modify: `src/features/dispatch/alert-queue.service.ts` (add `sweepExpired`)
- Modify: `src/features/dispatch/dispatch.service.ts` (run sweep at end of every tick)
- Test: `src/features/dispatch/alert-queue.repository.spec.ts`, `src/features/dispatch/dispatch.service.spec.ts`

**Interfaces:**
- Consumes: join helpers (`subscriptionMatch`, `filteredSpeciesMatch`, `priorDeliveryMatch`), `alertIdExpr`, `deliveries` statuses.
- Produces:
  - `export type ExpiredAlert = { alertId: string; channelId: string; comName: string }` (repository, re-exported by service).
  - `AlertQueueRepository.sweepExpiredAlerts(before: Date, floor: Date): Promise<ExpiredAlert[]>` — records `expired` rows for once-pending, never-delivered alerts with `floor < createdAt <= before`; returns them for logging.
  - `AlertQueue.sweepExpired(before: Date, floor: Date): Promise<ExpiredAlert[]>`.
  - `DispatchService.dispatchSince` runs the sweep after the send loop on EVERY tick (also when nothing is pending).

- [ ] **Step 1: Write the failing repository tests**

Add to `alert-queue.repository.spec.ts`:

```ts
describe("sweepExpiredAlerts", () => {
  const HOUR = 60 * 60 * 1000;

  it("records expired rows for aged-out undelivered alerts only", async () => {
    const now = Date.now();
    const before = new Date(now - 15 * 60 * 1000);
    const floor = new Date(now - 7 * 24 * HOUR);
    await seedLocation(db);
    await seedSubscription(db);
    // Aged out, undelivered -> expired.
    await seedObservation(db, { createdAt: new Date(now - HOUR), subId: "S1" });
    // Aged out but already delivered -> untouched.
    await seedObservation(db, { createdAt: new Date(now - HOUR), subId: "S2" });
    await seedDelivery(db, { alertId: "verfly:S2" });
    // Still inside the dispatch window -> untouched.
    await seedObservation(db, { createdAt: new Date(now), subId: "S3" });
    // Older than the floor -> untouched.
    await seedObservation(db, {
      createdAt: new Date(now - 8 * 24 * HOUR),
      subId: "S4",
    });

    const expired = await repository.sweepExpiredAlerts(before, floor);

    expect(expired).toEqual([
      { alertId: "verfly:S1", channelId: "CH1", comName: "Vermilion Flycatcher" },
    ]);
    const rows = await db.db
      .select()
      .from(deliveries)
      .where(eq(deliveries.status, "expired"));
    expect(rows).toHaveLength(1);
    expect(rows[0].alertId).toBe("verfly:S1");
  });

  it("is idempotent: re-sweeping records nothing new", async () => {
    const now = Date.now();
    const before = new Date(now - 15 * 60 * 1000);
    const floor = new Date(now - 7 * 24 * HOUR);
    await seedLocation(db);
    await seedSubscription(db);
    await seedObservation(db, { createdAt: new Date(now - HOUR) });

    await repository.sweepExpiredAlerts(before, floor);
    const second = await repository.sweepExpiredAlerts(before, floor);

    expect(second).toEqual([]);
    const rows = await db.db.select().from(deliveries);
    expect(rows).toHaveLength(1);
  });

  it("skips filtered species", async () => {
    const now = Date.now();
    await seedLocation(db);
    await seedSubscription(db);
    await seedFilter(db); // filters "Vermilion Flycatcher" on CH1
    await seedObservation(db, { createdAt: new Date(now - HOUR) });

    const expired = await repository.sweepExpiredAlerts(
      new Date(now - 15 * 60 * 1000),
      new Date(now - 7 * 24 * HOUR),
    );

    expect(expired).toEqual([]);
  });
});
```

Note on idempotency + re-sweep semantics: after the first sweep the alert HAS a delivery row, so `priorDeliveryMatch` excludes it — that's what makes re-sweeps no-ops. Import `eq` from drizzle-orm in the spec file if missing.

- [ ] **Step 2: Run to verify failure**

Run: `pnpm run test -- alert-queue.repository`
Expected: FAIL — `sweepExpiredAlerts` is not a function.

- [ ] **Step 3: Implement the repository sweep**

In `alert-queue.repository.ts` (add `lte` to the drizzle-orm import; add the type near `DeliveryRow`):

```ts
export type ExpiredAlert = {
  alertId: string;
  channelId: string;
  comName: string;
};
```

```ts
/**
 * Record 'expired' outcomes for alerts that were once pending and never got
 * one: created before the dispatch window opened (<= before) but after the
 * scan floor, still subscribed and unfiltered, with no delivery row. The
 * select-then-insert pair is not atomic, but the caller runs inside
 * DispatchJob's inFlight guard and the unique index makes replays no-ops.
 * Returns the swept alerts so the caller can log each loss (spec §4).
 */
async sweepExpiredAlerts(before: Date, floor: Date): Promise<ExpiredAlert[]> {
  const expired = await this.drizzle.db
    .select({
      alertId: alertIdExpr,
      channelId: channelEBirdSubscriptions.channelId,
      comName: observations.comName,
    })
    .from(observations)
    .innerJoin(locations, eq(locations.id, observations.locId))
    .innerJoin(channelEBirdSubscriptions, this.subscriptionMatch())
    .leftJoin(filteredSpecies, this.filteredSpeciesMatch())
    .leftJoin(deliveries, this.priorDeliveryMatch())
    .where(
      and(
        gt(observations.createdAt, floor),
        lte(observations.createdAt, before),
        isNull(filteredSpecies.channelId),
        isNull(deliveries.alertId),
      ),
    );

  if (expired.length === 0) return [];

  await this.drizzle.db
    .insert(deliveries)
    .values(
      expired.map((row) => ({
        alertId: row.alertId,
        channelId: row.channelId,
        kind: "ebird" as const,
        status: "expired" as const,
      })),
    )
    .onConflictDoNothing();

  return expired;
}
```

In `alert-queue.service.ts`:

```ts
import {
  AlertQueueRepository,
  type ExpiredAlert,
  type PendingEBirdAlert,
  type SubscriptionScope,
} from "./alert-queue.repository";

export type { ExpiredAlert, PendingEBirdAlert, SubscriptionScope };

/** Record 'expired' for aged-out undelivered alerts; returns them (spec §4). */
async sweepExpired(before: Date, floor: Date): Promise<ExpiredAlert[]> {
  return this.repository.sweepExpiredAlerts(before, floor);
}
```

Run: `pnpm run test -- alert-queue.repository` — PASS.

- [ ] **Step 4: Write the failing dispatch-service tests**

Add `sweepExpired` to the mock (`beforeEach`: `alertQueueMock.sweepExpired.mockReset().mockResolvedValue([])`), then:

```ts
it("sweeps expired alerts even when nothing is pending", async () => {
  const loggerWarnSpy = vi
    .spyOn(Logger.prototype, "warn")
    .mockImplementation(() => {});
  alertQueueMock.sweepExpired.mockResolvedValue([
    { alertId: "verfly:S9", channelId: "CH1", comName: "Vermilion Flycatcher" },
  ]);

  await service.dispatchSince(since);

  const SWEEP_FLOOR_MS = 7 * 24 * 60 * 60 * 1000;
  expect(alertQueueMock.sweepExpired).toHaveBeenCalledWith(
    since,
    new Date(since.getTime() - SWEEP_FLOOR_MS),
  );
  expect(loggerWarnSpy).toHaveBeenCalledWith(
    expect.stringContaining("verfly:S9"),
  );
});

it("sweeps after the send loop", async () => {
  alertQueueMock.pendingEBirdAlerts.mockResolvedValue([makeAlert()]);
  const calls: string[] = [];
  senderMock.send.mockImplementation(async () => {
    calls.push("send");
  });
  alertQueueMock.sweepExpired.mockImplementation(async () => {
    calls.push("sweep");
    return [];
  });

  await service.dispatchSince(since);

  expect(calls).toEqual(["send", "sweep"]);
});
```

The existing test "does not send or record when nothing is pending" keeps passing (`record` still uncalled; the sweep is a different method).

- [ ] **Step 5: Run to verify failure, then implement**

Run: `pnpm run test -- dispatch.service` — FAIL (early return skips the sweep; sweep not called).

In `dispatch.service.ts`, add at module level:

```ts
/** Sweep scan floor — matches the eBird fetch lookback (back=7). */
const SWEEP_FLOOR_MS = 7 * 24 * 60 * 60 * 1000;
```

Restructure `dispatchSince` so the early return no longer skips the sweep — final shape:

```ts
async dispatchSince(since: Date): Promise<void> {
  const pending = await this.alertQueue.pendingEBirdAlerts(since);

  if (pending.length === 0) {
    this.logger.debug(`No new alerts since ${since.toISOString()}`);
  }

  let sentCount = 0;
  for (const plan of planEBirdAlerts(pending)) {
    const refs = plan.alerts.map(toAlertRef);
    try {
      await this.sender.send(plan.channelId, plan.message);
      // Record immediately: a crash now loses at most this one plan's
      // records instead of the whole tick's (at-least-once, spec §2).
      await this.alertQueue.record(refs, "sent");
      sentCount += refs.length;
    } catch (err) {
      await this.handleSendFailure(plan.channelId, refs, err);
    }
  }

  if (sentCount > 0) {
    this.logger.log(`Delivered ${sentCount} alerts`);
  }

  // Alert-loss closure (spec §4): anything that aged out of the dispatch
  // window without an outcome gets an 'expired' row and a warning.
  const expired = await this.alertQueue.sweepExpired(
    since,
    new Date(since.getTime() - SWEEP_FLOOR_MS),
  );
  for (const alert of expired) {
    this.logger.warn(
      `Alert ${alert.alertId} (${alert.comName}) for channel ${alert.channelId} expired unsent`,
    );
  }
}
```

- [ ] **Step 6: Run tests, then commit**

Run: `pnpm run test && pnpm run check-types` — all pass.

```bash
git add src/features/dispatch/
git commit -m "feat(scrubjay-discord): sweep aged-out undelivered alerts into expired outcomes"
```

---

### Task 6: End-to-end verification pass

**Files:**
- Modify: none expected (fixes only if the gate fails)

- [ ] **Step 1: Full gate**

From `apps/scrubjay-discord`: `pnpm run test` (expect ~150 tests, all passing) and `pnpm run check-types`. From the workspace root: `pnpm -w run format-and-lint` (use `:fix` and amend the relevant commit if it flags formatting).

- [ ] **Step 2: Spec conformance sweep**

Verify each spec test case has a covering test (spec "Testing" section, cases 1–8):
1. per-plan recording order — `dispatch.service.spec.ts` "records each plan immediately"
2. permanent 50013 — "records a permanent permission failure"
3. permanent 10003 + deactivation — "deactivates the channel's subscriptions" + repository deactivation test
4. transient stays pending — "records nothing for transient failures"
5. overlap skip — `dispatch.job.spec.ts` "skips a tick while the previous one is still running"
6. sweep exactness + idempotency + filter exclusion — repository sweep tests
7. bootstrap suppressed — `bootstrap.service.spec.ts` assertion
8. migration default backfill — "defaults status to 'sent'"

Confirm `grep -rn "markSent" src/` is empty and `pendingWhere` in `alert-queue.repository.ts` is unchanged from before this plan.

- [ ] **Step 3: Report**

No commit. Report the gate results and any deviations from the plan.
