# Bulk Ingest — One Transaction Per Region

**Date:** 2026-07-10
**Status:** Approved
**Scope:** `apps/scrubjay-discord` (backlog item 2.2)

## Problem

`IngestService.ingestRegion` loops over transformed observations and calls
`ObservationRepository.upsertObservation` per row (`ingest.service.ts:36-45`).
Each call opens its own transaction containing two upserts — location, then
observation (`observation.repository.ts:15-82`). A 200-row tick is therefore
200 transactions / 400 round-tripped statements against a database that could
absorb the whole batch in one transaction with two (chunked) statements.

## Facts that shape the design (verified 2026-07-10)

1. **Location dedup is mandatory, not a perf nicety.** Postgres rejects a
   single `INSERT ... ON CONFLICT DO UPDATE` that touches the same row twice
   ("cannot affect row a second time"). One rare bird at a stakeout produces
   many checklists at the same `locId` in one fetch, so an un-deduped bulk
   location insert fails routinely.
2. **Observations are already deduped upstream.** `EBirdTransformer`
   collapses rows by `(speciesCode, subId)` (`ebird.transformer.ts:14-15`),
   so the observation bulk insert cannot hit the same-row error.
3. **Malformed rows never reach the repo.** `EBirdFetcher` does per-row
   `safeParse` with warn-and-skip (`ebird.fetcher.ts:71-81`). The per-row
   failure handling in the service loop guards a nearly unreachable path.
4. **Two residual poison-row vectors exist** — rows that pass zod today but
   would fail an insert:
   - `obsDt` is only `z.string()`; an unparseable date becomes `Invalid Date`
     in the transformer (`ebird.transformer.ts:45`).
   - `howMany` is `z.number()`, not `.int()`; a fractional count is rejected
     by the `integer` column.
   Today each fails only its own row; under bulk they would fail the region's
   whole batch. Both are closed at the zod layer (below), converting them into
   the existing warn-and-skip path.

## Decisions (made with owner, 2026-07-10)

1. **All-or-nothing per region.** One transaction per region: bulk location
   upsert, then bulk observation upsert. On failure, log and return 0 — the
   upserts are idempotent and the next tick retries the same window. No
   per-row fallback path (rejected: two code paths guarding a failure mode
   the zod tightening makes unreachable).
2. **Chunk statements, not transactions.** Postgres caps a statement at
   65,535 bind parameters (~4,000 observation rows at ~15 columns); a large
   region's 7-day notable pull can plausibly reach thousands of rows. Bulk
   inserts are issued in chunks of 1,000 rows *inside* the single
   transaction — atomicity preserved, no behavioral knob.
3. **Tighten validation instead of tolerating poison rows** (see Design §3).

## Design

### 1. Repository: `upsertObservations(batch: Observation[]): Promise<void>`

Replaces `upsertObservation` (no other callers exist). Behavior:

- Empty batch → return immediately (drizzle throws on `.values([])`).
- Dedup locations by `locId`, last-wins, **inside the repo** — the
  same-row-twice restriction is a Postgres artifact, so persistence owns it.
- One `db.transaction`:
  1. Bulk `insert(locations).values(dedupedLocs).onConflictDoUpdate` on
     `locations.id`, in chunks of 1,000.
  2. Bulk `insert(observations).values(rows).onConflictDoUpdate` on
     `(speciesCode, subId)`, in chunks of 1,000.
- The `set` clauses reference `excluded.<column>` (via `sql` raw refs) instead
  of per-row data values — required for multi-row upserts. `lastUpdated` is
  still set to `new Date()` as today.

### 2. Service: drop the loop

`ingestRegion` becomes: fetch → transform → `repo.upsertObservations(batch)`
→ return `batch.length`. On repo failure: log the error with region context
and return 0 (mirrors the existing fetch-failure branch). Return-value
consumers (`ingest.job.ts:36`, `bootstrap.service.ts:45`) only log/record the
count — no semantic change they can observe.

### 3. Validation tightening (fetcher/transformer layer)

- `ebird.schema.ts`: `howMany: z.number().int().optional()` — fractional
  counts now warn-and-skip at the fetcher instead of poisoning a batch.
- `obsDt`: reject unparseable dates at the schema layer
  (`z.string().refine(s => !Number.isNaN(Date.parse(s)))` or equivalent) so
  `new Date()` in the transformer can no longer produce `Invalid Date`.
  Note: backlog 1.4 will change *how* `obsDt` is parsed (pinned UTC); this
  item only guarantees it parses at all, and must not preempt 1.4's
  semantics.

## Testing

- `observation.repository.spec.ts` (real DB): batch insert of multiple
  observations sharing one `locId` succeeds (the dedup requirement);
  conflict-update semantics preserved (rename/count-change tests reworked to
  the batch API); empty batch is a no-op.
- `ingest.service.spec.ts`: the "continues past a failed observation" test is
  replaced by "repo failure logs and returns 0"; happy path asserts one
  `upsertObservations` call with the full batch.
- `ebird.fetcher.spec.ts`: fractional `howMany` and unparseable `obsDt` rows
  are skipped with a warning, not returned.

## Out of scope

- Retention/pruning and the `recentlyConfirmed` index (backlog 2.3).
- `obsDt` timezone semantics (backlog 1.4).
- `SourcesRepository` spec gap (backlog 2.6 note).
