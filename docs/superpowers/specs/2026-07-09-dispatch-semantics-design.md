# Dispatch Semantics — Overlap, Failure Recording, and Alert Loss

**Date:** 2026-07-09
**Status:** Approved
**Scope:** `apps/scrubjay-discord` dispatch pipeline (backlog items 1.2 + 1.3)

## Problem

Dispatch today is send-then-record with a single batched `markSent` at the end of
each tick (`dispatch.service.ts`), a `*/1` cron with no overlap protection
(`dispatch.job.ts`), and a pending definition of "created in the last 15 minutes
with no delivery row" (`alert-queue.repository.ts`). Three failure modes follow:

1. **Cross-tick double-send.** A tick that runs longer than 60s overlaps the next
   tick; both read the same pending set before either records, and every alert in
   the slow tick's batch is sent twice.
2. **Crash amplification.** Because recording is batched, a crash mid-loop loses
   the delivery records for *every* plan already sent that tick — all of them are
   re-sent on restart.
3. **Silent alert loss.** A failed send writes nothing. That is the retry
   mechanism (still pending → retried next tick), but when the alert's
   `created_at` ages past the 15-minute window it silently stops matching the
   pending query: never sent, never recorded, no log. Permanent failures
   (deleted channel) also retry pointlessly every minute until they age out.

## Decisions (made with owner, 2026-07-09)

1. **Delivery guarantee: at-least-once.** Duplicate over loss. Send-then-record
   stays; the design shrinks the duplicate window rather than eliminating it.
2. **Failure trail: status column on `deliveries`.** No separate dead-letter
   table, no attempt counters (the 15-minute window already caps retries at ~15).
3. **Dead channels: deactivate subscriptions on Unknown Channel (10003) only.**
   Permission errors do not deactivate — an admin can fix permissions and alerts
   resume on their own. Nothing is ever deleted.

## Design

### 1. Schema: `deliveries` becomes an outcome ledger

Add to `deliveries` (`drizzle.schema.ts`):

- `status text NOT NULL DEFAULT 'sent'`, CHECK-constrained to
  `('sent', 'failed', 'expired', 'suppressed')`. The default backfills existing
  rows as `sent` in the migration.
- `detail text` (nullable) — the Discord error code/message for `failed` rows;
  null for other statuses.

Unchanged: the `deliveries_unique_idx (alert_kind, alert_id, channel_id)` unique
index — one terminal outcome per alert per channel. The `sentAt` column keeps its
name (now "outcome recorded at"; a rename is not worth the migration).

**The pending query does not change.** `pendingWhere` already excludes any alert
with a delivery row (`isNull(deliveries.alertId)`), and every status is terminal,
so no status filtering is needed. Transient failures write no row and therefore
stay pending — same as today.

### 2. Send loop: record per plan, classify errors

`DispatchService.dispatchSince` records immediately after each plan instead of
accumulating a `sent` array:

- **Success** → record `sent` for that plan's alerts right away. A crash now
  loses at most one plan's records instead of the whole tick's.
- **Permanent Discord error** → record `failed` with the error code in `detail`;
  the alert is never retried. Permanent codes (from `DiscordAPIError.code`,
  surfaced by `channels.fetch` or `send` in `message-sender.service.ts`):
  - `10003` Unknown Channel — additionally set `active = false` on ALL of that
    channel's rows in `channel_ebird_subscriptions` and log at error level.
  - `50001` Missing Access, `50013` Missing Permissions — record `failed` only;
    subscriptions stay active.
- **Anything else** (network errors, 5xx; discord.js queues/retries 429s
  internally) → record nothing; the alert stays pending and retries next tick.

API change: `AlertQueue.markSent(alerts)` generalizes to
`AlertQueue.record(alerts, status, detail?)` (insert with `onConflictDoNothing`,
as today). `BootstrapService` calls `record(pending, "suppressed")` for the B6
startup-burst suppression, so bootstrap rows stop masquerading as real
deliveries in future stats.

### 3. Overlap guard

`DispatchJob` gains a `private inFlight = false` re-entrancy check: if a tick is
already running, skip and log at debug level. This eliminates the cross-tick
double-send for the single-instance deployment this is (documented in a comment;
multi-instance would need DB-level claims, which is out of scope). Ingest gets
no guard — overlapping upserts are idempotent.

### 4. Expiry sweep

After the send loop, still inside the same guarded tick, one additional query:
alerts with `created_at` between `now − 7 days` and `now − 15 minutes` that are
still subscribed and unfiltered and have **no** delivery row — i.e. alerts that
were once pending and never received an outcome. For each: insert an `expired`
delivery row (`onConflictDoNothing`) and log a warning naming species and
channel.

Properties:
- Reuses the existing join helpers (`subscriptionMatch`, `filteredSpeciesMatch`,
  `priorDeliveryMatch`) with a different window predicate.
- Idempotent and self-healing: after downtime, the first tick sweeps the whole
  backlog once; the unique index makes re-sweeps no-ops.
- The 7-day lower bound matches the eBird fetch lookback (`back=7`) and bounds
  the scan; `obs_created_at_idx` serves it.
- Cannot race the send loop: the `inFlight` guard serializes the entire tick,
  and the sweep's window (`< now − 15min`) is disjoint from the dispatch
  window (`> now − 15min`).

### 5. Resulting guarantees

- Duplicate window shrinks from "one tick's worth of sends" to "one plan":
  a crash in the gap between a single `send` and its `record`. Irreducible
  under at-least-once.
- Every alert that ever matched a subscription ends in exactly one of:
  `sent`, `failed` (with cause), `expired` (with warning log), or `suppressed`
  (bootstrap). Nothing is silent.
- Deleted channels stop generating work permanently; permission problems
  self-heal when fixed.

## Testing

Unit/integration cases (extend `dispatch.service.spec.ts`,
`alert-queue.repository.spec.ts`, `dispatch.job.spec.ts`,
`bootstrap.service.spec.ts`):

1. Crash mid-loop: plans recorded before the throw keep their `sent` rows; a
   rerun re-sends only the unrecorded plan (no duplicates for recorded ones).
2. Permanent error `50013`: `failed` row with code in `detail`; alert absent
   from next tick's pending; subscription still active.
3. Permanent error `10003`: `failed` row AND all subscriptions for that channel
   deactivated; error logged.
4. Transient error: no delivery row; alert still pending next tick.
5. Overlap: second `run()` while first is in flight is a no-op (debug log).
6. Sweep: aged-out undelivered alert gets `expired` + warning; delivered,
   filtered, and in-window alerts are untouched; re-running the sweep is a no-op.
7. Bootstrap: pre-existing alerts recorded as `suppressed`, not `sent`.
8. Migration: existing delivery rows read back as `status = 'sent'`.

## Out of scope

- DB-level claims / `FOR UPDATE SKIP LOCKED` (multi-instance safety).
- Dead-letter replay tooling.
- Attempt counters or retry backoff (window caps retries).
- `/status` command and health-endpoint consumers of the new statuses
  (Tier 2/3 backlog; this design only makes the data available).
