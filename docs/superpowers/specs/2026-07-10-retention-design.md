# Retention — Bounded Growth for Observations, Deliveries, Locations

**Date:** 2026-07-10
**Status:** Approved
**Scope:** `apps/scrubjay-discord` (backlog item 2.3, plus its two ride-along
query-health fixes)

## Problem

Nothing prunes anything: `observations`, `deliveries`, and `locations` grow
forever. The pending-alert scan and the `recentlyConfirmed` EXISTS probe
(`alert-queue.repository.ts:210-218`) degrade as the tables grow, and the
probe has no usable index (no current index leads with `species_code`).
The pending read has no `LIMIT`, so a pathological burst produces an
unbounded tick.

## Facts that shape the design (verified 2026-07-10)

1. **Pruned observations can resurrect with a fresh `createdAt`.** The eBird
   fetch re-sends every observation with `obsDt` in the last 7 days
   (`back=7`, `ebird.fetcher.ts`) on every tick, and the bulk upsert
   deliberately excludes `createdAt` from its conflict-update set
   (`observation.repository.ts:119-132`). Deleting an observation whose
   `obsDt` is still inside that lookback re-inserts it next tick with
   `createdAt = now` — it re-enters the 15-minute dispatch window, and if its
   delivery row was pruned too, it double-posts. Retention must keep
   observations until `obsDt` is safely outside the lookback.
2. **`createdAt` bounds `obsDt` from above.** `obsDt` is site-local wall
   clock at or before first-ingest time, within ≤1 day of timezone skew
   (backlog 1.4). So `createdAt < now − 14d` implies `obsDt` is outside both
   the 7-day re-ingest lookback and the 7-day `recentlyConfirmed` window,
   with ~6 days of margin. Pruning by `createdAt` reuses the existing
   `obs_created_at_idx`; pruning by `obsDt` would need a new index.
3. **`deliveries` is now the outcome audit trail**, not just dedup: statuses
   `sent`/`failed`/`expired`/`suppressed` (backlog 1.3 landed). Hard floor is
   ~8 days — the expired sweep scans `createdAt` back 7 days
   (`dispatch.service.ts:12`), and a missing delivery row inside that span
   causes spurious `expired` rows/warnings. Beyond that, retention is purely
   a history-value question. The only reader of old rows is the health
   endpoint's 24-hour count (`health.repository.ts:6`).
4. **`locations` → `observations` is `onDelete: cascade`**
   (`drizzle.schema.ts:52-57`): deleting a location deletes its observations.
   Location pruning must therefore be orphans-only, and must run *after* the
   observations prune. The anti-join is served by `obs_location_date_idx`
   (leads with `location_id`). The table is naturally bounded (one row per
   hotspot in subscribed regions) — this prune is hygiene, not correctness.
5. **Interleaving with dispatch is safe by construction.** Dispatch reads
   `createdAt > now − 15min`; the prune deletes `createdAt < now − 14d`.
   Disjoint rows, no coordination needed.

## Decisions (made with owner, 2026-07-10)

1. **Ops-only history: 30 days of deliveries.** No long-term stats retention;
   nothing reads past 24h today, and 30 days covers "why did/didn't this
   send" debugging. (Rejected: keep-forever, 1-year window.)
2. **Daily in-app cron, batched deletes.** Follows the existing jobs pattern.
   (Rejected: piggyback on ingest tick — hot-path coupling, 1,440 needless
   runs/day; pg_cron — new infra dependency, split ownership.) Batching
   caps the first run, which eats months of backlog: each pass deletes at
   most one batch and commits independently, so a crash resumes next day.
3. **Ride-alongs included:** `recentlyConfirmed` index, `LIMIT` on the
   pending read, orphan-location pruning.
4. **Windows are module consts**, like `CONFIRMED_WINDOW_DAYS`. Promoting
   knobs to config remains Tier 3 item 6.

## Design

### 1. Retention windows

| Table | Prune when | Basis |
|---|---|---|
| `observations` | `created_at < now() − 14 days` | Fact 2; uses `obs_created_at_idx` |
| `deliveries` | `sent_at < now() − 30 days` | Decision 1; ≥8-day floor per Fact 3 |
| `locations` | no observation references it (after obs prune) | Fact 4 |

No index on `deliveries.sent_at`: the table is small (one row per alert
actually matched to a subscription) and the job is daily — a scan is fine.
Note this in the code.

### 2. Repository: `features/retention/retention.repository.ts`

Three methods, each returning the total deleted count:

- `pruneObservations(cutoff: Date)` — batched:
  `DELETE FROM observations WHERE (species_code, sub_id) IN (SELECT … WHERE created_at < $cutoff LIMIT 10_000)`,
  repeated until a pass deletes 0 rows. Each pass is its own implicit
  transaction (deliberately not one big transaction — Decision 2).
- `pruneDeliveries(cutoff: Date)` — same batched shape keyed on `id`,
  predicate `sent_at < $cutoff`.
- `pruneOrphanLocations()` — same batched shape keyed on `id`, predicate
  `NOT EXISTS (SELECT 1 FROM observations WHERE location_id = locations.id)`.

Batch size is a module const (10,000), accepted as an optional parameter on
each method so tests can exercise the loop with a small value.

### 3. Service and job

- `features/retention/retention.service.ts` — runs the three prunes in
  order (observations → deliveries → orphan locations), logs one line per
  table with the deleted count. `RetentionModule` exports the service.
- `features/jobs/retention.job.ts` — `@Cron("17 4 * * *")` (quiet minute,
  off the top of the hour), `await bootstrapService.waitForBootstrap()`
  first, try/catch that logs the error and never throws (mirrors
  `dispatch.job.ts`). No in-flight guard: daily cadence cannot self-overlap,
  and the prunes are idempotent regardless. Wired into `JobsModule`.

### 4. Ride-along: `recentlyConfirmed` index

Add `index("obs_species_location_date_idx").on(t.speciesCode, t.locId, t.obsDt)`
to the `observations` table + generated migration. Serves the EXISTS probe's
exact predicate shape (`species_code = ? AND location_id = ? AND
observation_date > ?`). The existing EXPLAIN smoke test in
`alert-queue.repository.spec.ts` covers plan sanity.

### 5. Ride-along: LIMIT on the pending read

`buildPendingEBirdAlertsQuery` gains `ORDER BY observations.created_at ASC
LIMIT 500` (module const). Oldest-first drain; overflow lands next tick
(the 15-minute window gives ~15 attempts before the existing expired sweep
records the loss with warnings — the designed loss path from 1.3).
`backfillDeliveries` and `sweepExpiredAlerts` stay unlimited: both must see
the complete set to be correct.

## Error handling

- Job failure: logged via the job's catch, retried next day. Partial
  progress is kept (batches commit independently); reruns are no-ops for
  already-deleted rows.
- FK cascade from a concurrent location delete is impossible: only the
  retention path deletes locations, and only orphans.

## Testing

Real-DB specs, matching existing repository spec style:

- `retention.repository.spec.ts`:
  - Rows straddling each cutoff: older-than-cutoff deleted, younger kept
    (observations by `createdAt`, deliveries by `sentAt`).
  - Orphan location deleted; location with a surviving observation kept.
  - Batching loop: the repository methods take an optional batch-size
    parameter (defaulting to the module const); the spec passes a small one
    and verifies rows spanning several batches are all deleted.
  - Resurrection invariant: an observation with recent `createdAt` is never
    pruned, whatever its other fields — encodes Fact 1.
- `retention.service.spec.ts`: prune order (observations before orphan
  locations) and per-table count logging.
- `alert-queue.repository.spec.ts` addition: with more than LIMIT pending
  alerts, exactly LIMIT are returned, oldest `createdAt` first.
- `retention.job.spec.ts`: waits for bootstrap; a service throw is caught
  and logged, not propagated (mirrors existing job specs).

## Out of scope

- Making retention windows configurable (Tier 3 item 6).
- `timestamptz` migration and `obsDt` UTC pinning (backlog 1.4) — retention
  comparisons use the same session-TZ semantics as the rest of the app today
  and inherit 1.4's fix when it lands.
- Region input validation (2.4), dead-weight cleanup (2.5).
